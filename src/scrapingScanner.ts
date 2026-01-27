import { assert } from 'node:console';
import { chromium, Locator, Page } from 'playwright';

const baseURL = 'https://www.aircanada.com/home/us/en/aco/flights'

interface FlightSearchParams {
    origin: string
    destination: string
    departureDate: Date
    returnDate: Date
    adults: number
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
}

function main() {
    chromium.launch({headless: false}).then(async browser => {
        const context = await browser.newContext()
        const page = await context.newPage()
        console.log('Navigating to:', baseURL)
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
        console.log('Page loaded')
        await phase1_fillSearchForm(page, exampleSearch)
        const results = await phase2_handleSearchResults(page, exampleSearch)
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
    console.log('Waiting for search results to load...')
    await page.waitForSelector('.flight-count') // Adjust selector based on actual results page
    const flightCount: number = await page.locator('.flight-count').innerText({timeout:20_000}).then(text => {
        const match = text.match(/(\d+)\s+flights? found/i)
        return match ? parseInt(match[1], 10) : 0
    })
    console.log(`Found ${flightCount} flights.`)
   
    const flightRowsLocator = page.locator("li.flight-block-list-item")
    const rowCount = await flightRowsLocator.count()
    console.log(`Number of flight rows found: ${rowCount}`)
    const flightRows = await flightRowsLocator.all()

    const flightDetailsList: FlightDetails[] = []
    for (const [index, row] of flightRows.entries()) {
        if (index >= 3) return //limit to first 3 flights for now
        console.log(`Processing flight ${index + 1}`)
        await row.getByText("Details").click()
        await page.waitForSelector("#flightDetailsDialogHeader")
        const segmentLocator = await page.locator("ol.segments-info > li").all()
        console.log(`Flight ${index + 1} has ${segmentLocator.length} segments.`)
        const segments: (OriginSegment | ArrivalSegment)[] = [];

        for (const segment of segmentLocator) {
            //determine how to extract details from each segment
            
            //if `li > .layover` exists, we can skip it
            if (await segment.locator(".layover").count() > 0) {
                console.log('Skipping layover segment.')
                continue
            }
            
            //if its a li > .origin then there are departure details
            if (await segment.locator(".origin").count() > 0) {
                const flightStartTime = await segment.locator(".segment-time .start-time").innerText()
                //check for day change. if there is one it looks like <div class="day-change ng-star-inserted"> +1|2 day </div>
                const startTime = await getSegmentTime(segment, flightStartTime, searchParams.departureDate);

                const airportCode = await segment.locator(".airport-code").innerText()
                //flightnumber is .airline-name > first span
                const flightNumber = await segment.locator(".airline-name > span").first().innerText()
                console.log(`Departure Segment - Time: ${startTime}, Airport: ${airportCode}, Flight Number: ${flightNumber}`)
                segments.push({startTime, airportCode, flightNumber})
            } else {
                const flightEndTime = await segment.locator(".segment-time .end-time").innerText()
                const endTime = await getSegmentTime(segment, flightEndTime, searchParams.departureDate);
                const airportCode = await segment.locator(".airport-code").innerText()
                console.log(`Arrival Segment - Time: ${endTime}, Airport: ${airportCode}`)
                segments.push({endTime, airportCode})
            }
        }
        await page.locator("button#flightDetailsDialogCloseButton").click()

        await row.locator(".links-container button").getByText("Seats").click()
        await page.waitForSelector("#flights-layout")
        const seatTabLocator = page.locator("#flight-segment-tabs button:not([aria-hidden='true'])")
        const seatTabCount = await seatTabLocator.count()
        const seatTabs = await seatTabLocator.all()
        const seatDetailsArray: SeatDetails[] = []
        console.log(`Number of seat tabs found: ${seatTabCount}`)
        //for each tab
        for (const [tabIndex, tab] of seatTabs.entries()) {
            console.log(`Processing seat tab ${tabIndex + 1}`)
            await tab.click()
            //wait for seatmap to load
            await page.waitForSelector(".preview-seatmap-container")

            //get counts for the following classes on a td node: .cabinYSeat .occupied .cabinYPref .occupiedPref
            const standardSeatsOccupied = await page.locator("td.occupied").count()
            const standardSeatsAvailable = await page.locator("td.cabinYSeat:not(.occupied)").count()
            const preferedSeatsOccupied = await page.locator("td.occupiedPref").count()
            const preferedSeatsAvailable = await page.locator("td.cabinYPref:not(.occupied)").count()

            console.log(`Seat Details for tab ${tabIndex + 1}: Standard Seats - Available: ${standardSeatsAvailable}, Occupied: ${standardSeatsOccupied}; Preferred Seats - Available: ${preferedSeatsAvailable}, Occupied: ${preferedSeatsOccupied}`)
            seatDetailsArray.push({
                standardSeatsAvailable,
                standardSeatsOccupied,
                preferedSeatsAvailable,
                preferedSeatsOccupied
            })
        }
        //close tab
        await page.locator("#seatPreviewDialogCloseButton").click()


        //pair up origin and arrival segments
        assert(segments.length % 2 === 0, 'Segments length should be even after filtering out layovers')
        const flightDetails: FlightDetails = {
            flights: [],
            fares: {}
        }
        for (let i = 0; i < segments.length; i += 2) {
            const origin = segments[i] as OriginSegment
            const arrival = segments[i + 1] as ArrivalSegment
            const flight: Flight = {
                flightNumber: origin.flightNumber,
                departureTime: origin.startTime.toISOString(),
                arrivalTime: arrival.endTime.toISOString(),
                departureAirport: origin.airportCode,
                arrivalAirport: arrival.airportCode,
                duration: getDurationString(origin.startTime, arrival.endTime),
                seatDetails: seatDetailsArray[i / 2] //assume seatDetailsArray matches flight segments
            }
            flightDetails.flights.push(flight)
        }
        console.log(`Flight ${index + 1} Details:`, JSON.stringify(flightDetails, null, 2))
    }
    console.log('Completed processing all flights.')
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
