const fs = require('fs');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
const handlebars = require('handlebars');
const Twitter = require("twitter");
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
async function getRssFeeds() {
  let parser = new Parser();
  let retries = 0;
  keepTrying = true;

  do {
    try {
      console.log(`🐶 Attempt #${retries+1} to fetch ${blogFeed}`);
      await parser.parseURL(blogFeed, (err, feed) => {
        if(err) {
          userData.articles = [];
          retries++;
          return false;
        } else {
          userData.articles = feed.items.map(article => {
            return {
              ...article,
              title: article.title.replaceAll('*', '')
            }
          });
        }
      });          
    } catch {
      retries++;
    }
  } while (retries < 10 && userData.articles.length === 0)
}

/**
 * Fetch travel data
 */
async function getTravelData() {
  let retries = 0;
  let status = 0;

  do {
    console.log(`🐶 Attempt #${retries+1} to fetch ${travelData}`);
    const response = await fetch(travelData);
    const data = await response.json();
    status = response.status;

    if (status === 200) {
      userData = {
        ...userData,
        ...data
      }
      console.log(`✅ User data fetched and updated from ${travelData}.`);
    } else {
      retries++;
    }
  } while (retries < 10 && status !== 200)
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
  })

  return await client.get("account/verify_credentials", (err, res) => {
    if (err) {
      throwErrorAndExit(`🚨 ERROR: could not verify your Twitter credentials`, err);
    }

    if (res) {
      const followerCount = res.followers_count;
      console.log(`✅ Verified Twitter credentials.`);
      console.log(`#️⃣ Current follower count is ${followerCount}`);

      const whereAmI = `${userData.now.name}, ${userData.now.country}`
      if(res.location !== whereAmI) {
        updateTwitterBioLocation(client, whereAmI);
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

      console.log("\n🎉 Success! Updated Twitter bio/location");
    }
  )
}

const throwErrorAndExit = (message, err) => {
  if (err) {
    console.error(err);
  }

  throw new Error(`❌ ERROR: ${message}`);
  process.exit(1);
}

async function action() {
  await getTravelData();
  await getRssFeeds();
  await generateReadMe();
  await verifyTwitterCredentials();
}

action();