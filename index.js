var handlebars = require('handlebars');
var fs = require('fs');

let userData = {
  name: 'Mitch',
  from: 'Australia',
  now: 'Czechia',
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

handlebars.registerHelper('lt', function( a, b ){
	var next =  arguments[arguments.length-1];
	return (a < b) ? next.fn(this) : next.inverse(this);
});

async function getRssFeeds() {
  let Parser = require('rss-parser');
  let parser = new Parser();

  let retries = 0;

  do {
      try {
          console.log(`Attempted ${retries+1} to fetch https://mitchmalone.io/feed`)
          await parser.parseURL('https://mitchmalone.io/feed', (err, feed) => {
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
          keepTrying = false;
      } catch {
          retries++;
          keepTrying = true;
      }
  } while (retries < 11 && userData.articles.length === 0)
}

async function generateReadMe() {
  await fs.readFile('./main.hbs', function(err, data){
    if (!err) {
      var source = data.toString();

      var template = handlebars.compile(source);
      var outputString = template(userData);
      fs.writeFileSync('README.md', outputString);
    } else {
      // handle file read error
    }
  });
}

async function action() {
  // await setWeatherInformation();
  await getRssFeeds();
  await generateReadMe();
}

action();