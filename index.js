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

// async function setWeatherInformation() {
//   userData.city_temperature = 18.0;
//   userData.city_weather = 'Brno, Czechi';
//   userData.city_weather_icon = '10d';

//   // await fetch(`https://api.openweathermap.org/data/2.5/weather?q=stockholm&appid=${process.env.OPEN_WEATHER_MAP_KEY}&units=metric`)
//   // const lat = '49.2019854';
//   // const lon = '16.4378777';
//   // const API = '4986655aa56607aa6186e3860377ee02';
//   // await fetch(`https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${API}`)
//   //   .then(r => r.json())
//   //   .then(r => {
//   //     userData.city_temperature = Math.round(r.main.temp);
//   //     userData.city_weather = r.weather[0].description;
//   //     userData.city_weather_icon = r.weather[0].icon;
//   //   });
// }

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