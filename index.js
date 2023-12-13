const fs = require('fs');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
const handlebars = require('handlebars');
const Twitter = require("twitter");
const { resolve } = require('path');

require("dotenv").config();

/**
 * Sets up the URLs for data fetching
 */
const blogFeed = 'https://medium.com/feed/@mitchmalone';
const travelData = 'https://nomadmo.re/api/travel-data';

/**
 * Sets up the user object with some defauls
 */
let userData = {
  name: 'Mitch',
  from: 'Australia',
  now: {},
  locationCount: 0,
  countryCount: 0,
  articles: [],
  refresh_date: new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
    timeZone: 'Europe/Paris',
  }),
};

/**
 * Helper for formatting the Handlebars template. Old school, right?
 */
handlebars.registerHelper('lt', function( a, b ){
	var next =  arguments[arguments.length-1];
	return (a < b) ? next.fn(this) : next.inverse(this);
});

/**
 * Fetch latest articles from the blog
 */
async function getBlogData() {
  let parser = new Parser();

  console.log(`🐶 Attempting to fetch ${blogFeed}`);
  let feed = await parser.parseURL(blogFeed);

  userData.articles = feed.items.map(article => {
    return {
      ...article,
      title: article.title.replaceAll('*', '')
    }
  });

  console.log(`✅ Success! Blog data fetched ${userData.articles.length} articles.`);
}

/**
 * Fetch travel data
 */
async function getTravelData() {
  console.log(`🐶 Attempting to fetch ${travelData}`);

  await fetch(travelData).then(async (response) => {
    const data = await response.json();
    if (response.status === 200) {
      userData = {
        ...userData,
        ...data
      }
      
      console.log(`✅ Success! User data fetched and updated from ${travelData}.`);
    }
  }).catch(async (error) => {
    throwErrorAndExit(`Failed to fetch ${travelData}`);
  });
}

/**
 * Generates the README.md file from the Handlebars template.
 */
async function generateReadMe() {
  await fs.readFile('./template.hbs', function(err, data){
    if (!err) {
      var source = data.toString();

      var template = handlebars.compile(source);
      var outputString = template(userData);
      fs.writeFileSync('README.md', outputString);
    }
  });
}

/*
 * Checks and validates Twitter credentials
 */
async function verifyTwitterCredentials() {
  const client = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
  });

  console.log(`🛂 Verifying Twitter credentials.`);

  return await client.get("account/verify_credentials", (err, res) => {
    if (err) {
      throwErrorAndExit(`🚨 ERROR: could not verify your Twitter credentials`, err);
    }

    if (res) {
      console.log(`✅ Success! Verified @${res.screen_name} Twitter credentials (${res.followers_count} followers).`);

      const whereAmI = `${userData.now.name}, ${userData.now.country}`;

      if(res.location !== whereAmI) {
        console.log(`🗺️  Updating Twitter location to ${whereAmI}`);
        updateTwitterBioLocation(client, whereAmI);
      } else {
        console.log(`⏭️  Skip! Twitter bio/location already ${res.location}.`);
      }
    }
  })
}

async function updateTwitterBioLocation(client, location) {
  return await client.post( "account/update_profile", {location}, async (err) => {
      if (err) {
        console.error(err);
        throwErrorAndExit(`\n Failed to update Twitter bio location.`);
      }

      console.log(`✅ Success! Updated Twitter bio/location to ${location}`);
    }
  )
}

const throwErrorAndExit = (message) => {
  if (message) {
    console.error(`❌ ERROR: ${message}`);
  }

  process.exit(1);
}

async function action() {
  await getTravelData();
  await getBlogData();
  await verifyTwitterCredentials();
  await generateReadMe();
}

action();