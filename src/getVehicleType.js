import puppeteer from 'puppeteer';

// Singleton browser instance for reuse across requests
let browserInstance = null;

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

async function getBrowser() {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
  }
  return browserInstance;
}

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default async function getVehicleType({ licensePlate, licenseState }) {
  const logLabel = `getVehicleType(${licensePlate}, ${licenseState})`;

  console.time(logLabel); // eslint-disable-line no-console

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    // Set viewport to a standard desktop size
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the homepage
    await page.goto('https://www.lookupaplate.com/', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Select state from the dropdown
    await page.waitForSelector('select[name="stateCode"]', { timeout: 10000 });
    await page.select('select[name="stateCode"]', licenseState);

    // Type the license plate into the search input
    const input = await page.waitForSelector('input[type="text"]', {
      timeout: 10000,
    });
    await input.click({ clickCount: 3 }); // select any existing text
    await input.type(licensePlate);

    // Click the search button and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button'),
    ]);

    // Wait for the content to be loaded - look for the collapse sections
    await page
      .waitForSelector('div.collapse-arrow', { timeout: 10000 })
      .catch(() => {
        // Content may not exist for this plate
      });

    // Extract vehicle information from the page
    const result = await page.evaluate(() => {
      // Find value by looking for label text and getting adjacent sibling
      const getValueByLabel = label => {
        const allDivs = document.querySelectorAll('div');
        const labelDiv = Array.from(allDivs).find(
          d => d.textContent.trim() === label,
        );
        if (labelDiv && labelDiv.nextElementSibling) {
          return labelDiv.nextElementSibling.textContent.trim() || undefined;
        }
        return undefined;
      };

      return {
        vehicleYear: getValueByLabel('Model Year'),
        vehicleMake: getValueByLabel('Make'),
        vehicleModel: getValueByLabel('Model'),
        vehicleBody: getValueByLabel('Body Class'),
      };
    });

    console.timeEnd(logLabel); // eslint-disable-line no-console

    return {
      result: {
        ...result,
        licensePlate,
        licenseState,
      },
    };
  } finally {
    await page.close();
  }
}
