/**************************************************
 * Usage:
 *    1. Run `npm install axios axios-cookiejar-support tough-cookie cheerio qs`
 *    2. Run with `node scrap.js`
 **************************************************/
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const cheerio = require('cheerio');
const qs = require('qs');
const fs = require('fs').promises;

async function scrapeTenders(inputs) {
  // ------------------------------------------
  // 1. Set up cookie jar + axios wrapper
  // ------------------------------------------
  const jar = new tough.CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  // ------------------------------------------
  // 2. Retrieve the CSRF token from the login page
  // ------------------------------------------
  const LOGIN_URL = 'https://app.tendersgo.com/login';
  const EMAIL = 'automation@prezlab.com';
  const PASSWORD = 'AI@rfp2024';

  const getLoginResponse = await client.get(LOGIN_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
    },
  });

  const $loginPage = cheerio.load(getLoginResponse.data);

  // In many Laravel-based pages, CSRF tokens can appear in <input type="hidden" name="_token" value="...">
  // or in <meta name="csrf-token" content="...">. Adjust to whichever is present:
  const csrfToken =
    $loginPage('input[name="_token"]').attr('value') ||
    $loginPage('meta[name="csrf-token"]').attr('content');

  if (!csrfToken) {
    throw new Error('CSRF token not found on the login page.');
  }
  console.log('CSRF Token:', csrfToken);

  // ------------------------------------------
  // 3. POST the login request
  // ------------------------------------------
  const loginData = qs.stringify({
    _token: csrfToken,
    email: EMAIL,
    password: PASSWORD,
  });

  const loginResponse = await client.post(LOGIN_URL, loginData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
      Referer: LOGIN_URL,
    },
    maxRedirects: 0, // If TendersGo returns a redirect, we can detect successful login
    validateStatus: (status) => status === 200 || status === 302 || status === 303,
  });

  // If your login is successful, TendersGo may return a redirect (302/303) or load the page (200).
  console.log('Login response status:', loginResponse.status);

  // Optional: Check if login failed based on content
  if (loginResponse.status !== 200 && loginResponse.status !== 302 && loginResponse.status !== 303) {
    throw new Error('Login failed - unexpected status code: ' + loginResponse.status);
  }
  if (loginResponse.data && typeof loginResponse.data === 'string') {
    if (loginResponse.data.includes('Invalid credentials')) {
      throw new Error('Login failed - invalid credentials');
    }
  }
  console.log('Login successful!');

  // ------------------------------------------
  // 4. Scraper logic
  // ------------------------------------------
  // function that extracts the tender ID from the URL
  const extractTenderId = (url) => {
    // Example pattern: /tenders/<country>/tender-notice/<id>
    const matches = url.match(/tenders\/([^/]+)\/tender-notice\/([^/]+)/);
    if (matches && matches[1] && matches[2]) {
      return `${matches[1]}-${matches[2]}`;
    }
    return '';
  };

  // define the CSS selectors for the fields
  const selectors = {
    title: 'table.table-striped tr:nth-child(1) td span',
    country: 'table.table-striped tr:nth-child(2) td a',
    language: 'table.table-striped tr:nth-child(3) td a',
    organization: 'table.table-striped tr:nth-child(4) td a',
    published_date: 'table.table-striped tr:nth-child(5) td',
    deadline_date: 'table.table-striped tr:nth-child(6) td div div',
    overview_original: 'table.table-striped tr:nth-child(7) td div:first-child',
    overview_english: 'table.table-striped tr:nth-child(7) td div:nth-child(2)',
    naics: 'table.table-striped tr:nth-child(8) td div',
    cpvs: 'table.table-striped tr:nth-child(9) td div',
    unspsc: 'table.table-striped tr:nth-child(10) td div',
    regions: 'table.table-striped tr:nth-child(11) td div',
    sectors: 'table.table-striped tr:nth-child(12) td div',
    url: 'table.table-striped tr:nth-child(13) td div a[href]',
  };

  // function to scrape a single URL
  async function scrapeSingleTender(url) {
    // fetch the page
    const tenderResponse = await client.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
      },
    });

    if (tenderResponse.status !== 200) {
      throw new Error(`Failed to fetch page for ${url}: status ${tenderResponse.status}`);
    }

    // parse the response
    const $ = cheerio.load(tenderResponse.data);

    // fill the results into an object
    const tenderData = {};
    tenderData['tender-url'] = url;
    tenderData['tender-id'] = extractTenderId(url);

    for (const [field, selector] of Object.entries(selectors)) {
      const el = $(selector).first();
      if (field === 'url') {
        tenderData[field] = el.attr('href') || null;
      } else {
        tenderData[field] = el.text().trim() || null;
      }
    }

    return tenderData;
  }

  // function to scrape multiple tenders
  const results = [];
  for (const url of inputs.urls) {
    try {
      const data = await scrapeSingleTender(url);
      results.push(data);
    } catch (err) {
      console.error(`Error scraping ${url}:`, err.message);
    }
    // optional: small delay to be polite
    await new Promise((r) => setTimeout(r, 1000));
  }

  // ------------------------------------------
  // 5. Write results to local file and return
  // ------------------------------------------
  await fs.writeFile('tender_data.json', JSON.stringify(results, null, 4), 'utf-8');
  console.log('Scraping complete. Results saved to tender_data.json');

  return results;
}

// ------------------------------------------
// Example usage
// ------------------------------------------
(async () => {
  try {
    const urlsToScrape = [
      'https://app.tendersgo.com/tenders/hungary/tender-notice/rP5BmA1q'
    ];

    const finalData = await scrapeTenders({ urls: urlsToScrape });
    console.log('Final returned data:\n', finalData);
  } catch (error) {
    console.error('Error in main script:', error.message);
  }
})();
