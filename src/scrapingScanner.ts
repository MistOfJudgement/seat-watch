import { chromium, Page } from 'playwright';

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
        // await phase2_handleSearchResults(page)
        // await phase3_extractFlightDetails(page)
        await page.waitForTimeout(10000) // Wait for 10 seconds to observe the filled form
        await browser.close()
    })
    
}

async function phase1_fillSearchForm(page: Page, searchParams: FlightSearchParams) {
    (await page.waitForSelector("#flightsOriginLocationbkmgLocationContainer")).click()
    await page.fill('input#flightsOriginLocation', searchParams.origin);

    (await page.waitForSelector("#flightsOriginDestinationbkmgLocationContainer")).click()
    await page.fill('input#flightsOriginDestination', searchParams.destination)

    await page.fill("#bkmg-desktop_travelDates-formfield-1", formatDate(searchParams.departureDate))
    await page.fill("#bkmg-desktop_travelDates-formfield-2", formatDate(searchParams.returnDate))

    await page.click("#bkmg-desktop_findButton")
}
main()