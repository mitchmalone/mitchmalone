import fs from "fs/promises";
import fetch from "node-fetch";
import Parser from "rss-parser";
import handlebars from "handlebars";
import Twitter from "twitter";
import { throwErrorAndExit } from "./helpers/errorHelpers.js";

import "dotenv/config";

/**
 * Sets up the URLs for data fetching
 */
// const blogFeed = "https://medium.com/feed/@mitchmalone";
const blogFeed = "https://mitchmalone.io/feeds/rss.xml";
const travelData = "https://nomadmo.re/travel-data.json";

/**
 * Sets up the user object with some defauls
 */
let userData = {};

/**
 * Helper for formatting the Handlebars template. Old school, right?
 */
handlebars.registerHelper("lt", function (a, b) {
  var next = arguments[arguments.length - 1];
  return a < b ? next.fn(this) : next.inverse(this);
});

handlebars.registerHelper('toLowerCase', function(str) {
  return str.toLowerCase();
});

handlebars.registerHelper("diff", function (dateFrom, dateTo) {
  const then = new Date(dateFrom);
  const now = dateTo != null ? new Date(dateTo) : new Date();

  let years = now.getFullYear() - then.getFullYear();
  if (now.getMonth() < then.getMonth() || (now.getMonth() == then.getMonth() && now.getDate() < then.getDate())) {
    years--;
  }

  return years;
});

async function createUserProfile() {
  // open user.json and store data in a variable
  let user = await fs.readFile("./bio/user.json", "utf8");
  userData = JSON.parse(user);
}

/**
 * Fetch latest articles from the blog
 */
async function getBlogData() {
  let parser = new Parser();

  console.log(`🐶 Attempting to fetch blog data from ${blogFeed}`);
  let feed = await parser.parseURL(blogFeed);

  userData.articles = feed.items.map((article) => {
    return {
      ...article,
      title: article.title.replaceAll("*", ""),
    };
  });

  console.log(
    `✅ Success! Blog data fetched ${userData.articles.length} articles.`,
  );
}

/**
 * Fetch travel data
 */
async function getTravelData() {
  console.log(`🐶 Attempting to fetch travel data from ${travelData}`);

  await fetch(travelData)
    .then(async (response) => {
      let data = await response.json();
      data.now.city =
        data.now.address.split(",")[data.now.address.split(",").length - 1]; // get the last item in the address array

      if (response.status === 200) {
        userData = {
          ...userData,
          ...data,
        };

        console.log(
          `✅ Success! User data fetched and updated from ${travelData}.`,
        );
      }
    })
    .catch(async (error) => {
      throwErrorAndExit(`Failed to fetch ${travelData}`);
    });
}

/**
 * Generates the README.md file from the Handlebars template.
 */
async function generateReadMe() {
  console.log(`⚙️ Generating README.md file.`);

  const file = await fs.readFile("./bio/template_readme.hbs", "utf8");
  var source = file.toString();
  var template = handlebars.compile(source);

  var outputString = template({
    ...userData,
    refresh_date: new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      timeZoneName: "short",
      timeZone: "Australia/Hobart",
    }),
  });

  await fs.writeFile("README.md", outputString);
  console.log(`✅ Success! README.md file generated.`);
}

/**
 * Generates the index.mdx file for the MMIO website
 */
async function generateReadMmio() {
  console.log(`⚙️ Generating mmio-index-md.mdx file.`);

  const file = await fs.readFile("./bio/template_mmio.hbs", "utf8");
  var source = file.toString();
  var template = handlebars.compile(source);

  var outputString = template({
    ...userData,
    refresh_date: new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      timeZoneName: "short",
      timeZone: "Australia/Hobart",
    }),
  });

  await fs.writeFile("./bio/mmio.mdx", outputString);
  console.log(`✅ Success! mmio.mdx file generated.`);
}

/*
 * Checks and validates Twitter credentials
 */
async function tweetStuff() {
  const client = new Twitter({
    consumer_key: process.env.APP_API_KEY,
    consumer_secret: process.env.APP_API_KEY_SECRET,
    access_token_key: process.env.USER_ACCESS_TOKEN,
    access_token_secret: process.env.USER_ACCESS_TOKEN_SECRET,
  });

  console.log(`🛂 Verifying Twitter credentials.`);

  return await client.get("account/verify_credentials", (err, res) => {
    if (err) {
      throwErrorAndExit(`Could not verify your Twitter credentials`, err);
    }

    if (res) {
      console.log(
        `✅ Success! Verified @${res.screen_name} Twitter credentials (${res.followers_count} followers).`,
      );

      if (userData.now.city && userData.now.country) {
        const whereWasI = res.location;
        const whereAmI = `${userData.now.city}, ${userData.now.country}`;

        console.log(`🗺️  Updating Twitter location to ${whereAmI}`);
        if (whereWasI !== whereAmI) {
          updateTwitterBioLocation(client, whereAmI);
        } else {
          console.log(
            `⏭️  Skipping location update! Twitter bio/location already ${res.location}.`,
          );
        }
      } else {
        console.log(`⏭️  Skipping location update! No location set.`);
      }
    }
  });
}

async function updateTwitterBioLocation(client, location) {
  return await client.post(
    "account/update_profile",
    { location },
    async (err) => {
      if (err) {
        console.error(err);
        throwErrorAndExit(`Failed to update Twitter bio location.`);
      }

      console.log(`✅ Success! Updated Twitter bio/location to ${location}`);
    },
  );
}

async function action() {
  await createUserProfile();
  await getTravelData();
  await getBlogData();
  await generateReadMe();
  await generateReadMmio();
  await tweetStuff();
}

action();
