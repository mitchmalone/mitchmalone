let handlebars = require('handlebars');
let fs = require('fs');
let fetch = require('node-fetch');
let Parser = require('rss-parser');
let parser = new Parser();

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
  let retries = 0;
  keepTrying = true;

  do {
    try {
      console.log(`Attempted ${retries+1} to fetch ${blogFeed}`)
      await parser.parseURL(blogFeed, (err, feed) => {
        if(err) {
          userData.articles = [];
          console.log('ERR', err);
          return false;
        }

        userData.articles = feed.items.map(article => {
          return {
            ...article,
            title: article.title.replaceAll('*', '')
          }
        });
      });          

      retries++;
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
    console.log(`Attempted ${retries+1} to fetch ${travelData}`);
    const response = await fetch(travelData);
    const data = await response.json();

    status = response.status;

    if (status === 200) {
      userData = {
        ...userData,
        ...data
      }
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

async function action() {
  await getTravelData();
  await getRssFeeds();
  await generateReadMe();
}

action();