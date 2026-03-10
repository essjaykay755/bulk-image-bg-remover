#target photoshop

// Load the .ATN file if not already loaded
try {
    var actionFile = new File("ATN_PATH_PLACEHOLDER");
    app.load(actionFile);
} catch(e) {
    // Action set might already be loaded, that's OK
}

// Open input file
var inputFile = new File("INPUT_PATH_PLACEHOLDER");
app.open(inputFile);

// Suppress all dialogs during action playback
var originalDialogMode = app.displayDialogs;
app.displayDialogs = DialogModes.NO;

try {
    // Run the Photoshop action
    app.doAction("ACTION_NAME_PLACEHOLDER", "ACTION_SET_PLACEHOLDER");
} catch(e) {
    // If action fails, log error but continue to cleanup
    alert("Action error: " + e.message);
}

// Restore dialog mode
app.displayDialogs = originalDialogMode;

// Save output as PNG
var outputFile = new File("OUTPUT_PATH_PLACEHOLDER");
var pngOpts = new PNGSaveOptions();
pngOpts.compression = 6;
pngOpts.interlaced = false;
activeDocument.saveAs(outputFile, pngOpts, true);
activeDocument.close(SaveOptions.DONOTSAVECHANGES);

// Write done marker so the API knows processing is complete
var marker = new File("MARKER_PATH_PLACEHOLDER");
marker.open("w");
marker.write("done");
marker.close();
