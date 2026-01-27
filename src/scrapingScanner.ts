import { chromium, Locator, Page } from 'playwright';

const baseURL = 'https://www.aircanada.com/home/us/en/aco/flights'

interface FlightSearchParams {
    origin: string
    destination: string
    departureDate: Date
    returnDate: Date
    adults: number
    filter?: FilterDetails
}

interface FilterDetails {
    depOriTime?: string
    depArrTime?: string
    retOriTime?: string
    retArrTime?: string
}
// Optional criteria to identify a specific flight row before expanding details
interface TrackedFlightCriteria {
    flightNumbers?: string[] // e.g., ["AC 69", "NH 6805"]
    departureTimeText?: string // e.g., "10:30"
    arrivalTimeText?: string // e.g., "14:55"
    departureAirport?: string // e.g., "DCA"
    arrivalAirport?: string // e.g., "NRT"
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
        await phase1_fillSearchForm(page, exampleSearch)
        // If you want to track a specific flight, pass criteria here
        // const trackedCriteria: TrackedFlightCriteria = { flightNumbers: ["AC 69"] }
        const results = await phase2_handleSearchResults(page, exampleSearch /*, trackedCriteria*/)
        // await phase3_extractFlightDetails(page, exampleSearch)
        await page.waitForTimeout(10000) // Wait for 10 seconds to observe the filled form
        await browser.close()
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

async function phase2_handleSearchResults(page: Page, searchParams: FlightSearchParams) {
    // Phase 2 high-level flow:
    // 1) Wait for results & collect rows
    // 2) Optionally find the tracked flight row
    // 3) Extract segments & seat info for the selected rows

    const { flightCount, flightRows } = await phase2_waitForResults(page)
    console.log(`Found ${flightCount} flights.`)
    console.log(`Number of flight rows found: ${flightRows.length}`)

    const flightDetailsList: FlightDetails[] = []
    const maxToProcess = 3

    // If filter is provided, try to find that specific row first via FilterDetails
    let rowsToProcess: Array<{row: Locator, index: number}> = []

    if (searchParams.filter) {
        const tracked = await phase2_findRowByFilter(page, flightRows, searchParams.filter)
        if (tracked) {
            console.log(`Filtered flight found at index ${tracked.index + 1}`)
            rowsToProcess.push({ row: tracked.row, index: tracked.index })
        } else {
            console.log('Filtered flight not found in visible rows.')
            return []
        }
    }

    if (rowsToProcess.length === 0) {
        return []
        // rowsToProcess = flightRows.slice(0, Math.min(maxToProcess, flightRows.length)).map((row, index) => ({ row, index }))
    }

    for (const { row, index } of rowsToProcess) {
        console.log(`Processing flight ${index + 1}`)

        const fareDetails = await phase2_getFareDetails(row)
        const segments = await phase2_extractSegments(page, row, searchParams)
        const seatDetailsArray = await phase2_extractSeatDetails(page, row)

        if (segments.length % 2 !== 0) {
            console.warn('Uneven segment count; skipping row due to pairing issue.')
            continue
        }
        const flightDetails = phase2_buildFlightDetails(segments, seatDetailsArray, fareDetails)
        console.log(`Flight ${index + 1} Details:`, JSON.stringify(flightDetails, null, 2))
        flightDetailsList.push(flightDetails)
    }

    console.log('Completed processing selected flights.')
    console.log('Extracted Flight Details:', JSON.stringify(flightDetailsList, null, 2))
    return flightDetailsList
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

// === Phase 2 helper functions ===

async function phase2_waitForResults(page: Page): Promise<{ flightCount: number, flightRows: Locator[] }> {
    console.log('Waiting for search results to load...')
    await page.waitForSelector('.flight-count')
    const flightCount: number = await page.locator('.flight-count').innerText({ timeout: 20_000 }).then(text => {
        const match = text.match(/(\d+)\s+flights? found/i)
        return match ? parseInt(match[1], 10) : 0
    })
    const flightRowsLocator = page.locator('li.flight-block-list-item')
    const rows = await flightRowsLocator.all()
    return { flightCount, flightRows: rows }
}

async function phase2_findRowByFilter(page: Page, flightRows: Locator[], filter: FilterDetails): Promise<{ row: Locator, index: number } | null> {
    const isDepartingFlight = await page.getByText('Departing flight').isVisible().catch(() => false)
    // Match a row that contains all provided time hints from FilterDetails.
    const depOri = filter.depOriTime?.toLowerCase().trim()
    const depArr = filter.depArrTime?.toLowerCase().trim()
    const retOri = filter.retOriTime?.toLowerCase().trim()
    const retArr = filter.retArrTime?.toLowerCase().trim()

    for (const [index, row] of flightRows.entries()) {
        const timeline = await row.locator('.flight-timeline').innerText().then(text => text.toLowerCase())
        if (isDepartingFlight) {
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

async function phase2_extractSegments(page: Page, row: Locator, searchParams: FlightSearchParams): Promise<(OriginSegment | ArrivalSegment)[]> {
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

async function phase2_extractSeatDetails(page: Page, row: Locator): Promise<SeatDetails[]> {
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

function phase2_buildFlightDetails(segments: Array<OriginSegment | ArrivalSegment>, seatDetailsArray: SeatDetails[], fareDetails: FlightDetails["fares"]): FlightDetails {
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

async function phase2_getFareDetails(row: Locator): Promise<Record<string, number>> {
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