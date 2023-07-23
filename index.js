var handlebars = require('handlebars');
var fs = require('fs');

let userData = {
  name: 'Mitch',
  from: 'Australia',
  now: 'Czechia',
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

async function generateReadMe() {
  // await fs.readFile(MUSTACHE_MAIN_DIR, (err, data) => {
  //   if (err) throw err;
  //   const output = Mustache.render(data.toString(), DATA);
  //   fs.writeFileSync('README.md', output);
  // });
  await fs.readFile('./main.hbs', function(err, data){
    if (!err) {
      var source = data.toString();

      var template = handlebars.compile(source);
      var outputString = template(userData);
      console.log(outputString);
    } else {
      // handle file read error
    }
  });
}

async function action() {
  await generateReadMe();
}

action();