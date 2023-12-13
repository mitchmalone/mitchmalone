const fs = require('fs').promises;
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
async function getBlogData() {
  let parser = new Parser();

  console.log(`🐶 Attempting to fetch blog data from ${blogFeed}`);
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
  console.log(`🐶 Attempting to fetch travel data from ${travelData}`);

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
// async function generateReadMe() {
//   console.log(`⚙️ Generating README.md file.`);
  
//   return await fs.readFile('./template.hbs', function(err, data){
//     if (!err) {
//       var source = data.toString();

//       var template = handlebars.compile(source);
//       var outputString = template(userData);
//       fs.writeFileSync('README.md', outputString);

//       console.log(`✅ Success! README.md file generated.`);
//     }
//   });
// }
async function generateReadMe() {
  console.log(`⚙️ Generating README.md file.`);

  const file = await fs.readFile('./template.hbs', 'utf8');
  var source = file.toString();
  var template = handlebars.compile(source);
  var outputString = template(userData);
  await fs.writeFile('README.md', outputString);
  console.log(`✅ Success! README.md file generated.`);
}

/*
 * Checks and validates Twitter credentials
 */
async function verifyTwitterCredentials() {
  const client = new Twitter({
    consumer_key: process.env.APP_API_KEY,
    consumer_secret: process.env.APP_API_KEY_SECRET,
    access_token_key: process.env.USER_ACCESS_TOKEN,
    access_token_secret: process.env.USER_ACCESS_TOKEN_SECRET
  });

  console.log(`🛂 Verifying Twitter credentials.`);

  return await client.get("account/verify_credentials", (err, res) => {
    if (err) {
      throwErrorAndExit(`Could not verify your Twitter credentials`, err);
    }

    if (res) {
      console.log(`✅ Success! Verified @${res.screen_name} Twitter credentials (${res.followers_count} followers).`);

      if(userData.now.name && userData.now.country) {
        const whereAmI = `${userData.now.name}, ${userData.now.country}`;

        console.log(`🗺️  Updating Twitter location to ${whereAmI}`);
        if(res.location !== whereAmI) {
          updateTwitterBioLocation(client, whereAmI);
        } else {
          console.log(`⏭️  Skipping location update! Twitter bio/location already ${res.location}.`);
        }
      } else {
        console.log(`⏭️  Skipping location update! No location set.`);
      }
    }
  })
}

async function updateTwitterBioLocation(client, location) {
  return await client.post( "account/update_profile", {location}, async (err) => {
      if (err) {
        console.error(err);
        throwErrorAndExit(`Failed to update Twitter bio location.`);
      }

      console.log(`✅ Success! Updated Twitter bio/location to ${location}`);
    }
  )
}

const throwErrorAndExit = (message, err) => {
  if (message) {
    console.error(`❌ ERROR: ${message}`);
  }

  if (err) {
    console.error(err);
  }

  process.exit(1);
}

async function action() {
  console.log('APP_API_KEY',process.env.APP_API_KEY);
  console.log('APP_API_KEY_SECRET',process.env.APP_API_KEY_SECRET);
  console.log('USER_BEARER_TOKEN',process.env.USER_BEARER_TOKEN);
  console.log('USER_ACCESS_TOKEN',process.env.USER_ACCESS_TOKEN);
  console.log('USER_ACCESS_TOKEN_SECRET',process.env.USER_ACCESS_TOKEN_SECRET);
  // await getTravelData();
  // await getBlogData();
  // await generateReadMe();
  // await verifyTwitterCredentials();
}

action();