import promptSync from 'prompt-sync';
const prompt = promptSync({sigint: true});
import { createReadStream, readFile, writeFile } from "fs";
import { parse } from "csv-parse";
import fetch from "node-fetch";

//global constants

// list of buses that depart from UQ Lakes
const buses = ['66', '192', '169', '209', '29', 'P332', '139', '28'];
// list of UQ Lakes stop IDs 
const lakesStopId = ['1853', '1878', '1882', '1947'];
// urls
const vehiclePositionsURL = "http://127.0.0.1:5343/gtfs/seq/vehicle_positions.json";
const tripUpdatesURL= "http://127.0.0.1:5343/gtfs/seq/trip_updates.json";
// days
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// prompts and error messages
const welcomeMessage = "\nWelcome to the UQ Lakes station bus tracker!\n";
const invalidDateMessage = "Incorrect date format. Please use YYYY-MM-DD";
const datePrompt = "What date will you depart UQ Lakes station by bus? ";
const invalidTimeMessage = "Incorrect time format. Please use HH:mm";
const timePrompt = "What time will you depart UQ Lakes station by bus? ";
const invalidRouteMessage = "Please enter a valid option for a bus route.";
const routePrompt = "What bus route would you like to take? ";
const routeOptions = ["1 - Show All Routes", "2 - 66", "3 - 192", "4 - 169", "5 - 209", "6 - 29", "7 - P332", "8 - 139", "9 - 28"];
const searchAgainMessage = "Would you like to search again? ";
const invalidSearchMessage = "Please enter a valid option.";
const thanksMessage = "Thanks for using the UQ Lakes station bus tracker!";

// file paths
const routesFile = 'static-data/routes.txt';
const calendarFile = 'static-data/calendar.txt';
const tripsFile = 'static-data/trips.txt';
const stopTimesFile = 'static-data/stop_times.txt';

/**
 * Prompts user for the date and returns their input.
 * If invalid input entered, error message is printed.
 * @return {string} the date the user inputted
 */
function askDate() {
    const date = prompt(datePrompt);
    const datePattern = /^\d{4}\-\d{2}\-\d{2}$/;

    if (!datePattern.test(date) || !Date.parse(date)) {
        console.log(invalidDateMessage);
        return askDate();
    }
    return date;
}

/**
 * Prompts user for the time and returns their input.
 * If invalid input entered, error message is printed.
 * @return {string} the time the user inputted
 */
function askTime() {
    const time = prompt(timePrompt);
    const timePattern = /^([0,1][0-9]|[2][0-3]):([0-5][0-9])$/;

    if (!timePattern.test(time)) {
        console.log(invalidTimeMessage);
        return askTime();
    }
    return time;
}

/**
 * Prompts user for the route they wish to take and returns the bus route they chose
 * If invalid input entered, error message is printed
 * @return {array} contains the route short name of the bus(es) the user wants to take
 */
function askRouteName() {
    console.log(routeOptions);
    const route = prompt(routePrompt);
    
    if (isNaN(route) || route <= 0 || route > 9) {
        console.log(invalidRouteMessage);
        return askRouteName();
    }
    if (route == '1') {
        return buses;
    } else {
        return buses[route - 2]
    }
}

/**
 * Asks user whether or not they want to use the tracker again.
 * If invalid input entered, error message is printed
 * @return {boolean} true if user wants to search again; false otherwise
 */
function askToSearchAgain() {
    const ans = prompt(searchAgainMessage).toLowerCase();
    if (ans == 'y' || ans == 'yes') {
        return true;
    } else if (ans == 'n' || ans == 'no') {
        return false;
    } else {
        console.log(invalidSearchMessage);
        askToSearchAgain();
    }
}

/**
 * Parses the file at given filepath and returns contents as an array
 * @param {string} filePath file to parse
 * @returns {promise<array>} contents of file
 */
function parseFile(filePath) {
    const parser = parse({columns: true});
    const dataArray = []
    const promise = new Promise(function(resolve, reject) {
        createReadStream(filePath)
        .pipe(parser)
        .on('data', (data) => {dataArray.push(data);})
        .on('end', () => {resolve(dataArray)})
        .on('err', (err) => reject(err));   
    })
    return promise
}

/**
 * Parses the routes.txt file, filters based on given route names
 * @param {array} route array of routes 
 * @returns {promise<array>} data from routes.txt that contain the route names in the given 'route' array
 */
function parseRouteFile(route) {
    const parser = parse({columns: true});
    const dataArray = []
    const promise = new Promise(function(resolve, reject) {
        createReadStream(routesFile)
        .pipe(parser)
        .on('data', (data) => {if (route.includes(data['route_short_name'])) {dataArray.push(data)};})
        .on('end', () => {resolve(dataArray)})
        .on('err', (err) => reject(err));   
    })
    return promise
}

/**
 * Parses and filters the stop_times.txt file
 * @returns {promise<array>} data from stop_times.txt file if they include a stop at the UQ Lakes Station
 */
function parseStopFile() {
    const parser = parse({columns: true});
    const dataArray = []
    const promise = new Promise(function(resolve, reject) {
        createReadStream(stopTimesFile)
        .pipe(parser)
        .on('data', (data) => {if (lakesStopId.includes(data['stop_id'])) {dataArray.push(data)};})
        .on('end', () => {resolve(dataArray)})
        .on('err', (err) => reject(err));   
    })
    return promise
}

/**
 * Joins the routes data with trip data on the common field, route_id. Only keeps select fields.
 * @param {array} routes routes data
 * @param {array} trips trips data
 * @returns {array} joined route and trip data
 */
function joinRouteTrip(routes, trips) {
    const joined = trips.map(trip => {
        const route = routes.find(rt => rt.route_id === trip.route_id);
        if (route) {
            return {
                'Route Short Name': route.route_short_name,
                'Route Long Name': route.route_long_name,
                'Service ID': trip.service_id,
                'Trip ID': trip.trip_id,
                'Heading Sign': trip.trip_headsign
            };
        }
        return null;
    }).filter(item => item !== null);
    return joined;
}

/**
 * Joins the routes with stoptimes on the common field, trip_id. 
 * Entries are filtered to only keep those where arrival time is between the specified start and end times
 * @param {array} routes routes.txt data
 * @param {array} stops stop_times.txt data
 * @param {string} startTime earliest arrival time
 * @param {string} endTime latest arrival time
 * @returns {array} joined route and stoptimes data
 */
function joinTime(routes, stops, startTime, endTime) {
    const joined = stops.map(stop => {
        const route = routes.find(route => stop.trip_id === route['Trip ID'] && stop.arrival_time >= startTime && stop.arrival_time <= endTime);
        if (route) {
            return {
                ...route,
                'Scheduled Arrival Time': stop.arrival_time
            };
        }
        return null;
    }).filter(item => item !== null);
    return joined;
}

/**
 * Filters the routes based on the data in the calendar array
 * For each route, checks whether the bus service runs on that day/date
 * @param {array} routes routes data
 * @param {array} calendarArray calendar.txt data
 * @param {string} date the given date
 * @param {string} day the given day
 * @returns {array} filtered routes array
 */
function filterUsingCalendar(routes, calendarArray, date, day) {
    return routes.filter((route) => {
        return calendarArray.find(entry => entry.service_id === route['Service ID'] && entry[day] == '1' && date >= entry.start_date && date <= entry.end_date);
    })
}

/**
 * Joins routes with live position data on the common field, tripId
 * @param {array} routes routes data
 * @param {array} posArray live position data
 * @returns {array} joined routes and live position data
 */
function joinLivePosition(routes, posArray) {
    const joined = routes.map(route => {
        const entity = posArray.find(entity => entity.vehicle.trip.tripId === route['Trip ID']);
            return {
                'Route Short Name': route['Route Short Name'],
                'Route Long Name': route['Route Long Name'],
                'Service ID': route['Service ID'],
                'Heading Sign': route['Heading Sign'],
                'Scheduled Arrival Time': route['Scheduled Arrival Time'],
                'Live Arrival Time': route['Live Arrival Time'],
                'Live Position': entity ? entity.vehicle.position : 'No Live Data'
            };
    })
    return joined;
}

/**
 * Converts the given timestamp from unix time to 24 hour time
 * @param {string} timestamp timestamp to be converted
 * @returns {string} converted time
 */
function convertTime(timestamp) {
    const time = new Date(timestamp * 1000);
    return time.toLocaleTimeString("it-IT");
}

/**
 * Joins routes with live time data on the common field, tripId
 * and where the stop is a UQ Lakes Stop
 * @param {array} routes routes data 
 * @param {array} timeArray live time data
 * @returns {array} joined routes and live time array
 */
function joinLiveTime(routes, timeArray) {
    const joined = routes.map(route => {
        const entity = timeArray.find(entity => entity.tripUpdate.trip.tripId === route['Trip ID']);
        let timeEntry = null;
        if (entity) {
            const stopTimes = entity['tripUpdate']['stopTimeUpdate'];
            timeEntry = stopTimes.find(entry => lakesStopId.includes(entry.stopId));
        }
        return {
            ...route,
            'Live Arrival Time': timeEntry ? convertTime(timeEntry.departure.time) : 'No Live Data'
        };
    });
    return joined;
}

/**
 * Makes sure the given number is two digits, by adding a leading zero if needed
 * @param {number} n number  
 * @returns {string} string representation of number
 */
function padZero(n) {
    return ('0' + n).slice(-2)
}

/**
 * Adds 10 minutes to given date/time
 * @param {Date} date the given date
 * @returns {string} time with 10 mins added in format HH:mm:ss
 */
function add10Mins(date) {
    date.setMinutes(date.getMinutes() + 10);
    return padZero(date.getHours()) + ":" + padZero(date.getMinutes()) + ":00";
}

/**
 * Sorts the given routes entry by their Scheduled Arrival Time
 * @param {*} a route entry A
 * @param {*} b route entry B
 * @returns {number} 1 if A is greater; -1 if A is lesser; 0 if they are equal
 */
function sortByTime(a, b) {
    const timeA = a['Scheduled Arrival Time'];
    const timeB = b['Scheduled Arrival Time'];
    if (timeA > timeB) {
        return 1;
    } 
    if (timeA < timeB) {
        return -1;
    }
    return 0;
}

/**
 * Makes API call to given url, returns the data
 * @param {string} url url to get data from
 * @returns fetched data 
 */
async function fetchData(url) {
    const response = await fetch(url);
    const responseJSON = await response.json();
    return responseJSON;
}

/**
 * Reads data stored at given filepath and returns it in an array
 * @param {string} filename
 * @returns {array} data
 */
async function readCache(filename) {
    const dataArray = [];
    return new Promise((resolve, reject) => {
        readFile(`./cached-data/${filename}.json`, 'utf-8', function (err, data) {
            if (err) {
                // if file does not exist
                if (err.code == 'ENOENT') {
                    resolve(dataArray);
                }}
            if (data) {dataArray.push(data);}
            resolve(dataArray);
        });
    });
}

/**
 * Saves the given data to a file with the given filename
 * @param {string} filename filename to save data to
 * @param {*} data data to save
 */
async function saveCache(filename, data) {
    writeFile(`./cached-data/${filename}.json`, JSON.stringify(data), 
    (err) => {if (err) {console.log("fail");}})
}

/**
 * Main app loop
 * Initialises variables, prompts for input, parses and output data & results
 */
async function busTracker() {
    let trip;
    let calendar;
    let stopTime;
    const currentDate = new Date();
    let tripUpdateArray;
    let vehiclePositionArray;

    while (true) {
    const dateString = askDate();
    const time = askTime();
    const routeName = askRouteName();
    
    const s = new Date().getTime()
    // set date & time
    const date = new Date(dateString);
    date.setHours(time.split(":")[0]);
    date.setMinutes(time.split(":")[1]);

    // parse all static data files
    const rt = await parseRouteFile(routeName)
    if (!trip) {trip = await parseFile(tripsFile)};
    if (!calendar) {calendar = await parseFile(calendarFile)};
    if (!stopTime) {stopTime = await parseStopFile()};

    // join & filter static data
    const joinedRouteTrip = joinRouteTrip(rt, trip);
    const filteredTrips = filterUsingCalendar(joinedRouteTrip, calendar, dateString.split("-").join(""), days[date.getDay()]);
    const joinedTime = joinTime(filteredTrips, stopTime, time, add10Mins(date));

    // live data 
    const curr = new Date();   
    
    tripUpdateArray = readCache('trip_updates');
    vehiclePositionArray = await readCache('vehicle_positions');
    
    //vehiclePositionArray["header"]["timestamp"]                                       // time greater than 5 mins
    if (!tripUpdateArray.length || !vehiclePositionArray.length) {
        const tripUpdatesData = await fetchData(tripUpdatesURL);
        const vehiclePositionsData = await fetchData(vehiclePositionsURL);

        const filteredTripUpdates = tripUpdatesData["entity"].filter((entity) => entity.tripUpdate.stopTimeUpdate.some(e => lakesStopId.includes(e.stopId)));
        await saveCache('trip_updates', filteredTripUpdates);
        await saveCache('vehicle_positions', vehiclePositionsData);
        tripUpdateArray = await readCache('trip_updates');
        vehiclePositionArray = await readCache('vehicle_positions');
        tripUpdateArray = JSON.parse(tripUpdateArray);
        vehiclePositionArray = JSON.parse(vehiclePositionArray);

    } else {

    tripUpdateArray = JSON.parse(tripUpdateArray);
    vehiclePositionArray = JSON.parse(vehiclePositionArray);
    
    if ((vehiclePositionArray["header"]["timestamp"]  - currentDate.getTime())/60000 >= 5) {
        const tripUpdatesData = await fetchData(tripUpdatesURL);
        const vehiclePositionsData = await fetchData(vehiclePositionsURL);

        const filteredTripUpdates = tripUpdatesData["entity"].filter((entity) => entity.tripUpdate.stopTimeUpdate.some(e => lakesStopId.includes(e.stopId)));
        await saveCache('trip_updates', filteredTripUpdates);
        await saveCache('vehicle_positions', vehiclePositionsData);
        tripUpdateArray = await readCache('trip_updates');
        vehiclePositionArray = await readCache('vehicle_positions');
        tripUpdateArray = JSON.parse(tripUpdateArray);
        vehiclePositionArray = JSON.parse(vehiclePositionArray);
    }
    }

    // join live data
    const joinedLiveTime = joinLiveTime(joinedTime, tripUpdateArray);
    const finalTrips = joinLivePosition(joinedLiveTime, vehiclePositionArray["entity"]);
    
    console.table(finalTrips.sort(sortByTime));
    console.log(new Date().getTime() - s);
    if (askToSearchAgain()) {
        continue;
    } else {
        return;
    };
    }
}

/**
 * Main - prints welcome and thank you messages
 * Calls the main loop of the app
 */
async function main() {
    console.log(welcomeMessage);
    await busTracker();
    console.log(thanksMessage);
}
main();