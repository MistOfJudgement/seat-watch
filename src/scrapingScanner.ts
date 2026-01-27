import { chromium, Locator, Page } from 'playwright';
import fs from 'fs/promises';
const baseURL = 'https://www.aircanada.com/home/us/en/aco/flights'

interface FlightSearchParams {
    origin: string
    destination: string
    departureDate: Date
    returnDate: Date
    adults: number
    fareChoice: string
    filter: FilterDetails

}

interface FilterDetails {
    depOriTime?: string
    depArrTime?: string
    retOriTime?: string
    retArrTime?: string
}

function formatDate(date: Date): string {
    const day = String(date.getUTCDate()).padStart(2, '0')
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const year = date.getUTCFullYear()
    return `${day}/${month}/${year}`
}

const exampleSearch: FlightSearchParams = {
    origin: 'DCA',
    destination: 'NRT',
    departureDate: new Date("2026-05-24"),
    returnDate: new Date("2026-06-06"),
    adults: 1,
    fareChoice: "Flex",
    filter: {
        depOriTime: "9:40",
        depArrTime: "15:25",
        retOriTime: "17:35",
        retArrTime: "10:19",
    }
}

function main() {
    chromium.launch({headless: false}).then(async browser => {
        const context = await browser.newContext()
        const page = await context.newPage()
        console.log('Navigating to:', baseURL)
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
        console.log('Page loaded')
        
        // Step 1: Search for flights
        await phase1_fillSearchForm(page, exampleSearch)
        
        // Step 2: Get departure flight info
        const departureDetails = await getDepartureInfo(page, exampleSearch)
        if (!departureDetails) {
            console.error('Failed to get departure flight info')
            await browser.close()
            return
        }
        
        // Step 3: Get return flight info
        const returnDetails = await getReturnInfo(page, exampleSearch)
        if (!returnDetails) {
            console.error('Failed to get return flight info')
            await browser.close()
            return
        }
        
        console.log('Final Results:', JSON.stringify({ departure: departureDetails, return: returnDetails }, null, 2))
        await browser.close()
        //save to file

        const outputDir = './output'
        //save 1 per day
        const filename = `flight_${new Date().toISOString().split('T')[0]}.json`
        await fs.mkdir(outputDir, { recursive: true })
        await fs.writeFile(`${outputDir}/${filename}`, JSON.stringify({ departure: departureDetails, return: returnDetails }, null, 2))
        console.log(`Results saved to ${outputDir}/${filename}`)
    })
    
}

async function phase1_fillSearchForm(page: Page, searchParams: FlightSearchParams) {
    console.log('Filling search form with parameters:', searchParams)
    await page.getByText("Departing from").click()
    await page.getByLabel("From").fill(searchParams.origin)

    await page.getByText("Arriving in").click()
    await page.locator("input#flightsOriginDestination").fill(searchParams.destination)

    await page.getByLabel("Departure date").click()
    await page.getByLabel("Departure date").fill(formatDate(searchParams.departureDate))

    await page.getByLabel("Return date").click()
    await page.getByLabel("Return date").fill(formatDate(searchParams.returnDate))

    await page.locator("button#bkmg-desktop_travelDates_1_confirmDates").click()

    // We'll come back to adult selection later
    await page.locator("button#bkmg-desktop_findButton").click()
    console.log('Search form filled and submitted.')
}

interface OriginSegment {
    startTime: Date
    airportCode: string
    flightNumber: string
}

interface ArrivalSegment {
    endTime: Date
    airportCode: string
}

async function getDepartureInfo(page: Page, searchParams: FlightSearchParams) {
    return processSingleFlight(page, searchParams, searchParams.filter, 'Departing flight')
}

async function getReturnInfo(page: Page, searchParams: FlightSearchParams) {
    return processSingleFlight(page, searchParams, searchParams.filter, 'Return flight')
}

async function handleSearchResults(page: Page, searchParams: FlightSearchParams) {
    // Process departure flight first
    const departureDetails = await processSingleFlight(page, searchParams, searchParams.filter, 'Departing flight')
    if (!departureDetails) {
        console.warn('Failed to process departure flight.')
        return null
    }

    // After selecting departure fare, navigate to return flight results
    // Extract return flight with same fare choice
    const returnDetails = await processSingleFlight(page, searchParams, searchParams.filter, 'Return flight')
    if (!returnDetails) {
        console.warn('Failed to process return flight.')
        return null
    }

    return { departure: departureDetails, return: returnDetails }
}

async function processSingleFlight(page: Page, searchParams: FlightSearchParams, filter: FilterDetails, flightType: string) {
    await page.waitForURL(`**/rt/${flightType.toLowerCase().includes('departing') ? 'outbound' : 'inbound' }`, { timeout: 15000 })
    const { flightCount, flightRows } = await waitForResults(page)
    console.log(`Found ${flightCount} ${flightType} flights.`)
    console.log(`Number of flight rows found: ${flightRows.length}`)

    // Find the row matching the filter
    const filteredRow = await findRowByFilter(page, flightRows, filter, flightType)
    if (!filteredRow) {
        console.warn(`No ${flightType} row matched the provided filter criteria.`)
        return null
    }
    const { row, index } = filteredRow
    console.log(`Processing ${flightType} ${index + 1}`)

    const fareDetails = await getFareDetails(row)
    const segments = await extractSegments(page, row, searchParams)
    const seatDetailsArray = await extractSeatDetails(page, row)

    if (segments.length % 2 !== 0) {
        console.warn('Uneven segment count; skipping row due to pairing issue.')
        return null
    }
    const flightDetails = buildFlightDetails(segments, seatDetailsArray, fareDetails)
    console.log(`${flightType} ${index + 1} Details:`, JSON.stringify(flightDetails, null, 2))

    // Select flight based on fareChoice
    const fareOptions = await row.locator("ul.fare-tray-list li.fare-tray-list-item").filter({
        hasText: searchParams.fareChoice
    }).all()

    if (fareOptions.length === 0) {
        console.warn(`No fare options found matching choice: ${searchParams.fareChoice}`)
        return null
    } else {
        console.log(`Selecting ${flightType} fare option: ${searchParams.fareChoice}`)
        await fareOptions[0].getByRole('button', { name: 'Select' }).click()
        if (flightType.includes('Departing')) {
            await page.getByRole('button', { name: 'Continue with' }).click()
        }
    }

    return flightDetails
}

function getDurationString(start: Date, end: Date): string {
    const diffMs = end.getTime() - start.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    return `${diffHours}h ${diffMinutes}m`
}

interface FlightDetails {
    flights: Flight[] 
    fares: Record<string, number>
}

interface Flight {
    flightNumber: string
    departureTime: string
    arrivalTime: string
    departureAirport: string
    arrivalAirport: string
    duration: string
    // aircraftType: string
    seatDetails: SeatDetails
}

interface SeatDetails {
    standardSeatsAvailable: number
    standardSeatsOccupied: number
    preferedSeatsAvailable: number
    preferedSeatsOccupied: number
    // i don't really care about other seat types for now
}
main()

// flightTime is in HH:MM format (24-hour clock)
async function getSegmentTime(segment: Locator, flightTime: string, initialDate: Date) : Promise<Date> {
    const dayChangeCount = await segment.locator(".day-change").count();
    let outputDate = new Date(initialDate); // Start with the initial date

    const [hours, minutes] = flightTime.split(':').map(Number);
    outputDate.setUTCHours(hours, minutes, 0, 0); // Set time in UTC
    if (dayChangeCount > 0) {
        const dayChangeText = await segment.locator(".day-change").innerText();
        const dayMatch = dayChangeText.match(/\+(\d+)\s+day/);
        if (dayMatch) {
            const additionalDays = parseInt(dayMatch[1], 10);
            outputDate.setUTCDate(outputDate.getUTCDate() + additionalDays);
        }
    }
    return outputDate;
}

// === Helper functions ===

async function waitForResults(page: Page): Promise<{ flightCount: number, flightRows: Locator[] }> {
    console.log('Waiting for search results to load...')
    // await page.waitForSelector('.flight-count')
    // const flightCount: number = await page.locator('.flight-count').innerText({ timeout: 20_000 }).then(text => {
    //     const match = text.match(/(\d+)\s+flights? found/i)
    //     return match ? parseInt(match[1], 10) : 0
    // })
    await page.waitForSelector('li.flight-block-list-item', { timeout: 20000 })
    const flightRowsLocator = page.locator('li.flight-block-list-item')
    const flightCount = await flightRowsLocator.count()
    const rows = await flightRowsLocator.all()
    return { flightCount, flightRows: rows }
}

async function findRowByFilter(page: Page, flightRows: Locator[], filter: FilterDetails, flightType: string = 'Departing flight'): Promise<{ row: Locator, index: number } | null> {
    // Match a row that contains all provided time hints from FilterDetails.
    const depOri = filter.depOriTime?.toLowerCase().trim()
    const depArr = filter.depArrTime?.toLowerCase().trim()
    const retOri = filter.retOriTime?.toLowerCase().trim()
    const retArr = filter.retArrTime?.toLowerCase().trim()

    for (const [index, row] of flightRows.entries()) {
        const timeline = await row.locator('.flight-timeline').innerText().then(text => text.toLowerCase())
        if (flightType.includes('Departing')) {
            if ((depOri && !timeline.includes(depOri)) ||
                (depArr && !timeline.includes(depArr))) {
                continue
            }
        } else {
            if ((retOri && !timeline.includes(retOri)) ||
                (retArr && !timeline.includes(retArr))) {
                continue
            }
        }
        // If we reach here, all provided criteria matched
        return { row, index }
    }
    return null
}

async function extractSegments(page: Page, row: Locator, searchParams: FlightSearchParams): Promise<(OriginSegment | ArrivalSegment)[]> {
    await row.getByText('Details').click()
    await page.waitForSelector('#flightDetailsDialogHeader')
    const segmentLocator = await page.locator('ol.segments-info > li').all()
    console.log(`Row has ${segmentLocator.length} segments.`)
    const segments: (OriginSegment | ArrivalSegment)[] = []

    for (const segment of segmentLocator) {
        if (await segment.locator('.layover').count() > 0) {
            console.log('Skipping layover segment.')
            continue
        }

        if (await segment.locator('.origin').count() > 0) {
            const flightStartTime = await segment.locator('.segment-time .start-time').innerText()
            const startTime = await getSegmentTime(segment, flightStartTime, searchParams.departureDate)
            const airportCode = await segment.locator('.airport-code').innerText()
            const flightNumber = await segment.locator('.airline-name > span').first().innerText()
            segments.push({ startTime, airportCode, flightNumber })
        } else {
            const flightEndTime = await segment.locator('.segment-time .end-time').innerText()
            const endTime = await getSegmentTime(segment, flightEndTime, searchParams.departureDate)
            const airportCode = await segment.locator('.airport-code').innerText()
            segments.push({ endTime, airportCode })
        }
    }

    await page.locator('button#flightDetailsDialogCloseButton').click()
    return segments
}

async function extractSeatDetails(page: Page, row: Locator): Promise<SeatDetails[]> {
    await row.locator('.links-container button').getByText('Seats').click()
    await page.waitForSelector('#flights-layout')
    const seatTabLocator = page.locator("#flight-segment-tabs button:not([aria-hidden='true'])")
    const seatTabs = await seatTabLocator.all()
    const seatDetailsArray: SeatDetails[] = []
    console.log(`Number of seat tabs found: ${seatTabs.length}`)

    for (const [tabIndex, tab] of seatTabs.entries()) {
        console.log(`Processing seat tab ${tabIndex + 1}`)
        await tab.click()
        await page.waitForSelector('.preview-seatmap-container')

        const standardSeatsOccupied = await page.locator('td.occupied').count()
        const standardSeatsAvailable = await page.locator('td.cabinYSeat:not(.occupied)').count()
        const preferedSeatsOccupied = await page.locator('td.occupiedPref').count()
        const preferedSeatsAvailable = await page.locator('td.cabinYPref:not(.occupied)').count()

        console.log(`Seat Details for tab ${tabIndex + 1}: Standard Seats - Available: ${standardSeatsAvailable}, Occupied: ${standardSeatsOccupied}; Preferred Seats - Available: ${preferedSeatsAvailable}, Occupied: ${preferedSeatsOccupied}`)
        seatDetailsArray.push({
            standardSeatsAvailable,
            standardSeatsOccupied,
            preferedSeatsAvailable,
            preferedSeatsOccupied,
        })
    }

    await page.locator('#seatPreviewDialogCloseButton').click()
    return seatDetailsArray
}

function buildFlightDetails(segments: Array<OriginSegment | ArrivalSegment>, seatDetailsArray: SeatDetails[], fareDetails: FlightDetails["fares"]): FlightDetails {
    const flightDetails: FlightDetails = {
        flights: [],
        fares: fareDetails,
    }

    for (let i = 0; i < segments.length; i += 2) {
        const origin = segments[i] as OriginSegment
        const arrival = segments[i + 1] as ArrivalSegment
        const seatIndex = Math.min(Math.floor(i / 2), Math.max(0, seatDetailsArray.length - 1))
        const flight: Flight = {
            flightNumber: origin.flightNumber,
            departureTime: origin.startTime.toISOString(),
            arrivalTime: arrival.endTime.toISOString(),
            departureAirport: origin.airportCode,
            arrivalAirport: arrival.airportCode,
            duration: getDurationString(origin.startTime, arrival.endTime),
            seatDetails: seatDetailsArray[seatIndex],
        }
        flightDetails.flights.push(flight)
    }
    return flightDetails
}

async function getFareDetails(row: Locator): Promise<Record<string, number>> {
    await row.locator(".cabin-fare-container.availableCabin").first().click()
    const options = await row.locator("ul.fare-tray-list li.fare-tray-list-item").all()
    const fareDetails: Record<string, number> = {}
    
    for (const option of options) {
        // Skip if fare-family-title doesn't exist
        if (await option.locator("p.fare-family-title").count() === 0) {
            console.log('Skipping option without fare-family-title')
            continue
        }
        
        const fareFamily = await option.locator("p.fare-family-title").innerText()
        const fareFamilyCabin = await option.locator("p.fare-family-cabin-label").innerText()
        const priceText = (await option.locator(".fare-family-price-cont span").first().innerText()).replace(/[^\d.]/g, '')
        const price = parseFloat(priceText)
        fareDetails[`${fareFamily} (${fareFamilyCabin})`] = price
        console.log(`Fare Option: ${fareFamily} (${fareFamilyCabin}) - Price: ${price}`)
    }
    
    return fareDetails
}