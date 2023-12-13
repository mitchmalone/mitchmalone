const throwErrorAndExit = (message, err) => {
  if (message) {
    console.error(`❌ ERROR: ${message}`);
  }

  if (err) {
    console.error(err);
  }

  process.exit(1);
}

export { throwErrorAndExit };