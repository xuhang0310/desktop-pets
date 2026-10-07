// Isolated launcher regression fixture: ensure a failing child cannot report success.
const { app } = require('electron');
app.disableHardwareAcceleration();
app.exit(23);
