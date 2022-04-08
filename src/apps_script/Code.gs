// Change this to match the real spreadsheet URL!
// Will look something like: "https://docs.google.com/spreadsheets/d/<numbers_and_letters>/edit"
const spreadsheetUrl = "URL_HERE";

// Change this to match the real sheet name containing the data!
const spreadsheetTabName = "Sheet1";

// Auto-created, no need to change
const spreadsheetGeodataTabName = "Geodata";

// Change these names (the strings on the right side of the equals) to match
// EXACTLY what they are called in the header of the spreadsheet columns.
const YOUR_FIRST_NAME_FIELD = 'Your first name';
const OTHER_FIRST_NAME_FIELD = 'Additional parent / caregiver first name';
const INDIVIDUAL_NAME_FIELD = 'Name of individual with STXBP1';
const CITY_FIELD = 'City';
const STATE_PROV_FIELD = 'State/Province';
const COUNTRY_FIELD = 'Country';
const YEAR_BORN_FIELD = 'Year born';
const WHAT_TO_SHOW_FIELD = 'How would you like to be shown on our community world map?';

// Change these to the EXACT name of the options for the "How would you like
// to be shown..." question in the form.
const NAME_AND_YEAR_OPT = 'First name / year of birth';
const NAME_OPT = 'First name';
const YEAR_OF_BIRTH_OPT = 'Year of birth';
const ANONYMOUS_OPT = 'Simple icon (anonymous)';
const DO_NOT_DISPLAY_OPT = 'Do not display';

// Google geocoder response constants
const GEO_LAT_FIELD = 0;
const GEO_LNG_FIELD = 1;
const GEO_COUNTRY_FIELD = 2;
const GEO_STATE_FIELD = 3;
const GEO_CITY_FIELD = 4;
const GEO_FIELD_COUNT = 5;

const today = new Date();

// Process a GET request to this webapp.
function doGet(e) {
  const geo = Maps.newGeocoder();
  const ss = SpreadsheetApp.openByUrl(spreadsheetUrl);

  // Raw user-supplied data
  const userSheet = ss.getSheetByName(spreadsheetTabName);
  const userData = userSheet.getDataRange().getValues();
  //Logger.log("Sheet data: %s", userData);  // REMOVE

  // Bookkeeping for cached geodata
  var geoSheet = ss.getSheetByName(spreadsheetGeodataTabName);
  if (!geoSheet) {
    Logger.log("Creating 'Geodata' sheet");
    geoSheet = ss.insertSheet(spreadsheetGeodataTabName);
  }

  // Check headers (just overwrite them)
  const headers = ['lat', 'lng', 'country', 'state', 'city'];
  geoSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Cached geo data
  const geoRange = geoSheet.getDataRange();
  const geoData = geoRange.getValues().slice(1);
  //Logger.log("Geo data: %s", geoData);  // REMOVE

  // Build reverse map of header name to column index
  //Logger.log("Column names: %s", userData[0]);
  const h2c = new Map();
  userData[0].forEach((v, i) => h2c.set(v, i));

  // Response collections
  const markers = [];
  const countryTally = new Map();

  // Helper function for geocoder responses
  function getComponent(location, type) {
    const c = location.address_components.find(component => component.types.indexOf(type) >= 0);
    return c ? c.long_name : undefined;
  }

  // Helper function: Build address from provided components.
  function getInputLocation(row) {
    var city = row[h2c.get(CITY_FIELD)] || "";
    if (city.length > 0) {
      city = city + ", ";
    }

    var state = row[h2c.get(STATE_PROV_FIELD)] || "";
    if (state.length > 0) {
      state = state + ", ";
    }
    var userCountry = row[h2c.get(COUNTRY_FIELD)];

    return city + state + userCountry;
  }

  // Helper function: convert address to lat/lng and city/state/country.
  function doGeocode(userRow) {
    const inputLocation = getInputLocation(userRow);
    Logger.log('Performing geocode lookup for: %s, from %s', inputLocation, userRow);
    const geoResponse = geo.geocode(inputLocation);
    Logger.log(JSON.stringify(geoResponse, null, '  '));  // REMOVE

    if (geoResponse.status === 'OK') {
      // There may be multiple locations in the response. We'll use the first one, I guess.
      const location = geoResponse.results[0];
      return [
        location.geometry.location.lat,
        location.geometry.location.lng,
        getComponent(location, 'country') || "BUG: No country geocoded",
        getComponent(location, 'administrative_area_level_1') || '',
        getComponent(location, 'locality') || ''
      ];
    } else {
      Logger.log('ERROR: invalid location "%s", geocode returned: %s', inputLocation, geoResponse);
      return [0, 0, 'ERROR'];
    }
  }

  // MAIN PROCESSING
  // Loop through each input row.
  userData.slice(1).forEach((row, rowIndex) => {

    // We're storing the geocode lookup results in a separate sheet, since calling
    // that API is slow. Do some bookkeeping to read that cached data and set
    // 'geoRow', else leave it null if nothing is cached. The plan is to only
    // do a lookup once per row, ever. If we should need to update things, those
    // rows can be deleted from the Geodata sheet, or delete the entire sheet.
    if (rowIndex >= geoData.length) {
      geoData.push([]);
    }
    var geoRow;
    //Logger.log(geoData[rowIndex]);
    if (geoData[rowIndex] && geoData[rowIndex].length >= 3 /* required cols */) {
      geoRow = geoData[rowIndex];
      // If anything is invalid, rebuild it all. City & state can be missing.
      if (!parseFloat(geoRow[GEO_LAT_FIELD]) || !parseFloat(geoRow[GEO_LNG_FIELD]) || geoRow[GEO_COUNTRY_FIELD].length === 0) {
        geoRow = null;
      }
    }

    // Issue (slow) geocode call to get lat/lng, if not cached
    if (!geoRow) {
      geoRow = doGeocode(row);
      geoData[rowIndex] = geoRow;
    }

    // Look at user supplied input to figure out what we should show.
    // THIS IS IMPORTANT: we don't want to disobey the registrant's wishes.
    const yearBorn = parseInt(row[h2c.get(YEAR_BORN_FIELD)]);
    const whatToShow = row[h2c.get(WHAT_TO_SHOW_FIELD)];
    var individual, age;
    switch (whatToShow) {
      case NAME_AND_YEAR_OPT:
        individual = row[h2c.get(INDIVIDUAL_NAME_FIELD)];
        age = today.getFullYear() - yearBorn;
        break;
      case NAME_OPT:
        individual = row[h2c.get(INDIVIDUAL_NAME_FIELD)];
        break;
      case YEAR_OF_BIRTH_OPT:
        age = today.getFullYear() - yearBorn;
        break;
      case ANONYMOUS_OPT:
        break;
      case DO_NOT_DISPLAY_OPT:
        break;
      default:
        info = 'BUG: option not recognized: ' + whatToShow;
        break;
    }

    // We didn't ask about showing the registrant's name, only the name of the
    // STXBP1 person. We're only going to show first names. We could show last name,
    // or show nothing.
    var caregiver = row[h2c.get(YOUR_FIRST_NAME_FIELD)];
    const caregiver2 = row[h2c.get(OTHER_FIRST_NAME_FIELD)];
    if (caregiver2) {
      caregiver = `${caregiver} & ${caregiver2}`;
    }

    // Build array of map markers based on LatLng (position, name, details).
    // Don't add them unless they agreed to it!
    if (whatToShow != DO_NOT_DISPLAY_OPT) {
      markers.push({
        lat: geoRow[GEO_LAT_FIELD],
        lng: geoRow[GEO_LNG_FIELD],
        country: geoRow[GEO_COUNTRY_FIELD],
        state: geoRow[GEO_STATE_FIELD],
        city: geoRow[GEO_CITY_FIELD],
        individual,
        age,
        caregiver
      });
    }

    // Counts for each country. Not necessary, there's enough data in the
    // markers data to rebuild this client side, but why not?
    var tally = countryTally.get(geoRow[GEO_COUNTRY_FIELD]) || 0;
    countryTally.set(geoRow[GEO_COUNTRY_FIELD], tally + 1);
  });

  // Store all the geodata back to the sheet for caching. Skip the header row!
  geoSheet
    .getRange(2, 1, geoData.length, geoData[0].length)
    .setValues(geoData);

  // Build the response and send it
  const response = {
    markers: markers,
    countries: Array.from(countryTally).sort((a, b) => b[1] - a[1])
  };
  //Logger.log('OUTPUT');
  //Logger.log(JSON.stringify(response, null, '  '));
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}


