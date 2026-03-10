#target photoshop

// Suppress all dialogs during action playback
var originalDialogMode = app.displayDialogs;
app.displayDialogs = DialogModes.NO;

var success = false;
var errorMsg = "";

try {
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

    // Run the Photoshop action
    app.doAction("ACTION_NAME_PLACEHOLDER", "ACTION_SET_PLACEHOLDER");

    // Save output as PNG
    var outputFile = new File("OUTPUT_PATH_PLACEHOLDER");
    var pngOpts = new PNGSaveOptions();
    pngOpts.compression = 6;
    pngOpts.interlaced = false;
    activeDocument.saveAs(outputFile, pngOpts, true);
    activeDocument.close(SaveOptions.DONOTSAVECHANGES);

    success = true;
} catch(e) {
    errorMsg = e.message || "Unknown error";
    // Try to close the document if it's still open
    try {
        if (app.documents.length > 0) {
            activeDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch(e2) {}
}

// Restore dialog mode
app.displayDialogs = originalDialogMode;

// ALWAYS write the marker file so the API never hangs
var marker = new File("MARKER_PATH_PLACEHOLDER");
marker.open("w");
marker.write(success ? "done" : ("error:" + errorMsg));
marker.close();
