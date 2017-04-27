/**
 * @author Julia Heil
 * @fileOverview Retrieve user's chrome history and search details and process into JSON objects for D3 charts
 * <pre>
 *        Uses a chrome history API to retrieve data
 *        Uses alaSQL (in-memory SQL DB) to process the data for D3 usage
 *
 *
 * Overall strategy
 *    1. Setup listener for D3 visualizations
 *    2. Call chrome.history and chrome.visits with callback functions
 *    3. Augment any data items, 'join' history and visit data and push to data array
 *    4. Process the final data set (sort, calculate dwell times, diagnostics
 *    5. Build alaSQL query results for D3 operations
 *
 * Core API history strategy was based on mechanism used here:
 * </pre>
 * @see Chrome History API: {@link https://developer.chrome.com/extensions/history}
 * @see Chrome History search & visits methods: {@link https://developer.chrome.com/extensions/history#method-getVisits}
 * @see alaSQL Overview: {@link http://alasql.org/}
 */

/**
 * <pre>
 * Chrome API will allow a 'limit' on total record extracted, independent of Query - have not hit yet with any
 * real user data.  Will adjust if queries or API search are no longer subsecond
 * </pre>
 * @const
 * @default
 */
const CHROME_MAX_DATA_ITEMS = 100000;

// ====== TopVisits parameters =======
/**
 * Maximum domains to include in D3 topvisits chart (only so many bars will fit on a chart)
 * @const
 * @default
 */
const TOPVISITS_MAX_DOMAINS = 35;
// ====== WordCloud parameters ========
/**
 * Maximum number of words to include in D3 wordCloud chart
 * @const
 * @default
 */
const WORDCLOUD_MAX_WORDS = 30;
// ====== Time of Day parameters =======
/**
 * Interval length in minutes for Time of Day D3 chart
 * @const
 * @default
 */
const TIMEINTERVAL = 15;
// ====== streamgraph parameters ======
/**
 * <pre>
 * Maximum number days of history to include in D3 streamgraph
 *    0 - all history, otherwise number of days of history
 * </pre>
 * @const
 * @default
 */
const STREAMGRAPH_NUMDAYS = 30;
/**
 * <pre>
 * Maximum number domains to include in D3 streamgraph. Minimum value is 1.
 *    Domains are ranked and included by:
 *           - total visits over time period selected
 *           - total dwell time over time period selected
 * </pre>
 * @const
 * @default
 */
const STREAMGRAPH_MAX_DOMAINS = 100;
/**
 * <pre>
 * Maximum amount of Dwell time allowed for any visit
 *   Dwell time is 'computed', since it is not available in chrome history API
 *   Dwell is calculated as min(MAX_DWELL_HOURS, time (in hours) from the start of the current visit
 *   until the start of the next visit.  In order to approximate what a user might see, this limit
 *   is used.  The user could leave their computer, go to sleep, turn their computer off, etc.
 * </pre>
 * @const
 * @default
 */
const MAX_DWELL_HOURS = 4;
// ==== Active trace testing variables ===========================
/**
 * <pre>
 * Number of days included in the ActiveTrace query.  This will return whole days of info  -
 * and up to the current time for today.  All time is computed in local time.
 * Example: you select 1, a partial day of data is returned and the last start time
 * will be a few milliseconds from when the quey bagan.
 * IMPORTANT: the end-time for ActiveTrace to be 23:59 if the end time goes into the next calendar day.
 * This enforces a rule that start time is always the same or less than the end time.
 * </pre>
 * @const
 * @default
 */
const ACTIVETRACE_NUMDAYS = 1;
/**
 * <pre>
 * Maximum number domains to include in D3 streamgraph. Minimum value is 1.
 * Domains are ranked and included by:
 *   - total dwell time over time period selected
 * </pre>
 * @const
 * @default
 */
const ACTIVETRACE_MAX_DOMAINS = 100;
/**
 * <pre>
/* The smallest window of time that is returned in the ActiveTrace queries.
 * measured in hours i.e .0833 = 5 min .01667 = 1 min
 * if you use 0 you will see windows where start time and end times are
 * identical (because a visit lasted for only seconds)
 * </pre>
 * @const
 * @default
 */
const ACTIVE_TRACE_MIN_WINDOW = 0.017;

//============================================================
/**
 * @typedef {Object} streamgraphDwell
 * @property {string} data Format: mm/dd/yy
 * @property {string} key  Domain name
 * @property {Number} rank Overall ranking of the domain in hours of dwelltime over selected time range
 * @property {Number} value Total dwelltime in hours for the domain for the specified day
 */

/**
 * @function streamgraphDwell
 * @return {streamgraphDwell}
 *<pre>
 * Returns JSON Object for streamgraphDwell D3 graph
 * example {date: "03/25/17", key: "mail.google.com", rank: 1, value: 3.1751861225721574}
 * For each key, There is ONE and ONLY one object for every date within the specified date range.
 *</pre>
 */
function streamgraphDwell() {
    var streamgraphDwell = {pq: [], numdays: STREAMGRAPH_NUMDAYS, maxDomains: STREAMGRAPH_MAX_DOMAINS};
    console.time("alaSQL streamgraph dwell query");
    var pq6 = alasql("SELECT domain, SUM(dwellTime) AS [value], ROWNUM() AS rank FROM ? " +
        //   "WHERE (LENGTH(shortDomain) <= 30) " +
        "GROUP BY domain ORDER BY [value] DESC LIMIT " + STREAMGRAPH_MAX_DOMAINS.toString(), [chromedata]);

    var pq4 = alasql("SELECT t1.domain as [key], t1.rank, SUM(t2.dwellTime) AS [value], t2.dateStamp AS date " +
        " FROM ? AS t1 JOIN ? AS t2 USING domain " +
        " GROUP by domain, rank, t2.dateStamp", [pq6, chromedata]);

    //consoleQueryStats(pq4, chromedata, "Dwell Time BY Top N domains, date");
    //make sure we have a value for every date
    for (var i = 0, len = pq6.length; i < len; i++) {
        fillGaps(pq4, Math.max(streamgraphSearchStartTime, chromedata.startTime()),
            chromedata.endTime(), pq6[i].domain, pq6[i].rank);
    }
    //consoleQueryStats(pq4, chromedata, "Dwell time BY Top N domain - Gap Filled, date");
    streamgraphDwell.pq = alasql("SELECT rank, [key], date, SUM([value]) AS [value] FROM ? " +
        "GROUP BY rank, [key], date ORDER BY rank, date", [pq4]);
    //consoleQueryStats(streamgraphDwell.pq, chromedata, "alaSQL Dwell Query");
    console.timeEnd("alaSQL streamgraph dwell query");
    return streamgraphDwell;
}

/**
 * @typedef {Object} streamgraphVisits
 * @property {string} data Format: mm/dd/yy
 * @property {string} key  Domain name
 * @property {Number} rank Overall ranking of the domain in total visits over selected time range
 * @property {Number} value Total visits for the domain for the specified day
 */

/**
 * @function streamgraphVisits
 * @return {streamgraphVisits}
 * <pre>
 * Returns JSON Object for streamgraphVisits D3 graph
 * example {date: "03/25/17", key: "mail.google.com", rank: 1, value: 125}
 * For each key, There is ONE and ONLY one object for every date within the specified date range.
 * </pre>
 */
function streamgraphVisits() {
    var streamgraphVisits = {pq: [], numdays: STREAMGRAPH_NUMDAYS, maxDomains: STREAMGRAPH_MAX_DOMAINS};
    console.time("alaSQL streamgraph visits query");
    var pq6 = alasql("SELECT domain, COUNT(*) AS [value], ROWNUM() AS rank FROM ? " +
        "GROUP BY domain ORDER BY [value] DESC LIMIT " + STREAMGRAPH_MAX_DOMAINS.toString(), [chromedata]);

    var pq4 = alasql("SELECT t1.domain as [key], t1.rank, COUNT(t2.*) AS [value], t2.dateStamp AS date " +
        "FROM ? AS t1 JOIN ? AS t2 USING domain " +
        "GROUP by domain, rank, t2.dateStamp", [pq6, chromedata]);

    //consoleQueryStats(pq4, chromedata, "Visit count BY Top N domains, date");
    for (var i = 0, len = pq6.length; i < len; i++) {
        fillGaps(pq4, Math.max(streamgraphSearchStartTime, chromedata.startTime()),
            chromedata.endTime(), pq6[i].domain, pq6[i].rank);
    }
    //consoleQueryStats(pq4, chromedata, "Visit count BY Top N domain - Gap Filled, date");
    streamgraphVisits.pq = alasql("SELECT rank, [key], date, SUM([value]) AS [value] FROM ? " +
        "GROUP BY rank, [key], date ORDER BY rank, date", [pq4]);
    //consoleQueryStats(streamgraphVisits.pq, chromedata, "alaSQL Visits Query");
    console.timeEnd("alaSQL streamgraph visits query");
    return streamgraphVisits;
}

/**
 * @typedef {Object} activeTrace
 * @property {string} urlname url of visited item
 * @property {string} start Visit start time (format HH:MM)
 * @property {string} end Visit end time (format HH:MM)
 * @property {Number} value Total visits for the domain for the specified day
 */

/**
 * @function activeTrace
 * @return {activeTrace}
 * <pre>
 *     Returns a JSON object for the ActiveTrace D3 chart
 * </pre>
 */
function activeTrace() {
    var activeTrace = {hourdata: [], timestampdata: []};
    console.time("alaSQL activeTrace query: ");
    var pq6 = alasql("SELECT domain, SUM(dwellTime) AS [value] FROM ? " +
        "WHERE ((dwellTime > " + ACTIVE_TRACE_MIN_WINDOW + " ) AND (visitTime >  " + queryStartTimeActiveTrace + ")) " +
        "GROUP BY domain ORDER BY [value] DESC LIMIT " + ACTIVETRACE_MAX_DOMAINS.toString(), [chromedata]);

    var pq2 = alasql("SELECT domain as urlName, visitStartTime AS [start], visitEndTime AS [end] FROM ? " +
        "JOIN ? AS pq6 USING domain " +
        "WHERE ((dwellTime > " + ACTIVE_TRACE_MIN_WINDOW + " ) AND (visitTime >  " + queryStartTimeActiveTrace + ")) " +
        "ORDER BY start ASC LIMIT " + ACTIVETRACE_MAX_DATA_ITEMS.toString(), [chromedata, pq6]);

    var pq3 = alasql("SELECT domain as urlName, visitStartTimeStamp AS [start], visitEndTimeStamp AS [end] FROM ? " +
        "JOIN ? AS pq6 USING domain " +
        "WHERE ((dwellTime > " + ACTIVE_TRACE_MIN_WINDOW + " ) AND (visitTime >  " + queryStartTimeActiveTrace + ")) " +
        "ORDER BY start ASC LIMIT " + ACTIVETRACE_MAX_DATA_ITEMS.toString(), [chromedata, pq6]);
    //consoleQueryStats(pq2, chromedata, "alaSQL HH:MM - Active Trace data by domain, start and end");
    //consoleQueryStats(pq3, chromedata, "alaSQL XX/XX/XX HH:MM - Active Trace data by domain, start and end");
    this.hourdata = pq2;
    this.timestampdata = pq3;
    console.timeEnd("alaSQL activeTrace query: ");
    return activeTrace;
}
/*
 * <pre>
 * Returns JSON Object for activeTrace D3 graph
 * example {url: "www.google.com", start: "14:20", end: "15:12"}
 * If end every 'precedes' start time, end is changed to 23:59.  Only visits that exceed @ACTIVE_TRACE_MIN_WINDOW
 * are included in return JSON.  Only the top @ACTIVE_TRACE_MAX_DOMAINS are included.
 * </pre>
 */
function tod() {
    //timeOfDay return data
    var tod = {timeSlot: [], heatmap: []};
    // Increment the rate count for each visit found (in timeslot array)
    //console.time("Calculate: Time of Day");
    var msec, val, i, index, index2, len;
    var d = new Date();
    //var timezone = 8;
    //  2. Setup a list of timeslots {time: minutes_since_midnite, rate: 0) for (1440 / TIMEINTERVAL) slots
    tod.timeSlot = [];
    for (i = 0; i < (60 * 24) / TIMEINTERVAL; i++) {
        tod.timeSlot.push({timeindex: (TIMEINTERVAL * i),  rate: 0,
                           time: timeOfDay((i+d.getTimezoneOffset()*60/TIMEINTERVAL)*TIMEINTERVAL*60*1000)});
    }
    top.heatmap=[];
    for (var day =1; day<=7; day++) {
        for (var hour=1; hour<=24; hour++) {
            tod.heatmap.push(({day: day, hour:hour, rate:0}));
        }
    }
    for (i = 0, len = chromedata.length; i < len; i++) {
        msec = chromedata[i].visitTime;
        d.setTime(msec - (msec % (60 * TIMEINTERVAL * 1000)));
        val = d.getHours() * 60 + d.getMinutes();
        index = val / TIMEINTERVAL;
        index2 = d.getDay() * 24 + d.getHours();
        tod.heatmap[index2].rate++;
        tod.timeSlot[index].timeindex = val;
        tod.timeSlot[index].time = timeOfDay(d);
        tod.timeSlot[index].rate++;
    }
    tod.timeSlot.sort(function (a, b) {
            return a.timeindex - b.timeindex;
    });
    //console.timeEnd("Calculate: Time of Day");
    return tod;
}

function wordCloud() {
    // WordCloud return data
    var wordCloud = {wordList: []};
    //console.time("alaSQL wordCloud query: ");
    wordCloud.wordList = alasql(
        "SELECT shortDomain AS text, COUNT(*) AS size FROM ? " +
        "WHERE (visitTime >  " + streamgraphSearchStartTime + ") " +
        "GROUP by shortDomain ORDER BY size DESC LIMIT " + WORDCLOUD_MAX_WORDS, [chromedata]);
    //console.log(this.wordList);
    // console.timeEnd("alaSQL wordCloud query: ");
    return wordCloud;
}

function topVisits() {
    var topVisits = {history: []};
    console.time("alaSQL topVisits query: ");
    topVisits.history = alasql(
        "SELECT domain, COUNT(*) AS visits FROM ? " +
        "WHERE (visitTime >  " + streamgraphSearchStartTime + ") " +
        "GROUP by domain ORDER BY visits DESC LIMIT " + TOPVISITS_MAX_DOMAINS, [chromedata]);
    //console.log(this.history);
    console.timeEnd("alaSQL topVisits query: ");
    return topVisits;
}

var streamgraphSearchStartTime =
    (STREAMGRAPH_NUMDAYS === 0 ? 0 : (new Date()).getTime() - (24 * 60 * 60 * 1000) * STREAMGRAPH_NUMDAYS);
var queryStartTimeActiveTrace = (STREAMGRAPH_NUMDAYS === 0 ? 0 : msecSinceDay(ACTIVETRACE_NUMDAYS));

//var searchStartTime = streamgraphSearchStartTime;
var searchStartTime = Math.min(streamgraphSearchStartTime, streamgraphSearchStartTime);

//return responses
var testQuery = {pq: [], numdays: STREAMGRAPH_NUMDAYS, maxDomains: STREAMGRAPH_MAX_DOMAINS};

//main data element - generated from chrome calls - used for all SQL queries
var chromedata = [];
chromedata.startTime = function () {
    return chromedata[0].visitTime;
};
chromedata.endTime = function () {
    return chromedata[chromedata.length - 1].visitTime;
};

chromedata.activeTraceCalc = function () {
    //console.time("Calculate: ActiveTrace");
    var m = chromedata.startTime(), m1 = timeOfDay(m), m2 = timeStamp(m), m3 = new Date(m);
    var n, n1, n2, n3, i, len;
    for (i = 0, len = chromedata.length - 1; i < len; i++) {
        n = chromedata[i + 1].visitTime;
        n1 = timeOfDay(n);
        n2 = timeStamp(n);
        n3 = new Date(m);
        chromedata[i].visitStartTime = m1;
        chromedata[i].visitStartTimeStamp = m2;
        chromedata[i].visitEndTime = n1;
        chromedata[i].visitEndTimeStamp = n2;
        if (dateStamp(m3) !== dateStamp(n3)) {
            //make sure start time is not after end time
            chromedata[i].visitEndTime = "23:59";
        }
        m = n;
        m1 = n1;
        m2 = n2;
        m3 = n3;
    }
    //console.timeEnd("Calculate: ActiveTrace");
};

chromedata.streamgraphDwellCalc = function () { //magic - how long did we linger?
    var i, dwell, len;
    //console.time("Calculate: dwell");
    for (i = 0, len = chromedata.length - 1; i < len; i++) {
        dwell = chromedata[i + 1].visitTime - chromedata[i].visitTime;
        //this is stored as hours
        chromedata[i].dwellTime = Math.min(MAX_DWELL_HOURS, dwell / 3600 / 1000);
    }
    // last visit has no dwell time
    chromedata[chromedata.length - 1].dwellTime = 0;
    //console.timeEnd("Calculate: dwell");
};

//  1. Setup all D3 listeners
chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        refreshChromeData(chromedata.endTime() + 100); //add 100 msec to last captured element
        if (request.greeting === "viz5D3") {
            if (request.graph === "Hours") {
                sendResponse(streamgraphDwell());
            }
            else {
                sendResponse(streamgraphVisits());
            }
        }
        else if (request.greeting === "activeTraceData") {
            sendResponse(activeTrace());
        }
        else if (request.greeting === "timeOfDayD3") {
            sendResponse(tod());
        }
        else if (request.greeting === "wordCloudD3") {
            sendResponse(wordCloud());
        }
        else if (request.greeting === "topVisitsD3") {
            sendResponse(topVisits());
        }
    });

//  2. Call chrome.history and chrome.visits with callback functions
refreshChromeData(searchStartTime);

function refreshChromeData(stime) {
    var numRequestsOutstanding = 0;
    // h -  single record of returned history results
    var h, i, len;
    console.time("Chrome history-search call");
    chrome.history.search({text: "", maxResults: CHROME_MAX_DATA_ITEMS, startTime: stime},
        // For each history item, get details on all visits.
        function (historyItems) {
            for (i = 0, len = historyItems.length; i < len; ++i) {
                h = historyItems[i];
                processVisitsWithUrl(h);
                /*
                 processVisitsWithUrl = function (hItem) {
                 return function (visitItems) {
                 processVisits(hItem, visitItems);
                 };
                 };
                 */
                // now get corresponding visits for these history items
                chrome.history.getVisits({url: h.url}, processVisitsWithUrl(h));
                numRequestsOutstanding++;
            }
            console.log("Found :", i, "new search items");
            console.timeEnd("Chrome history-search call");
        });

    var processVisitsWithUrl = function (hItem) {
        return function (visitItems) {
            processVisits(hItem, visitItems);
        };
    };
    // 3. Augment any data items, 'join' history and visit data and push to data array
    var processVisits = function (h, visitItems) {
        for (i = 0, len = visitItems.length; i < len; i++) {
            // build valid host name
            h.domain = urlDomain(h.url);
            //build short domain name
            h.shortDomain = prettyDomain(h.domain);
            visitItems[i].dateStamp = dateStamp(visitItems[i].visitTime);
            if ((h.shortDomain.length <= 30) &&
                (visitItems[i].visitTime >= stime) &&
                (h.shortDomain.length > 0)) {
                chromedata.push(extend(visitItems[i], h));
            }
        }
        if (!--numRequestsOutstanding) {
            onAllVisitsProcessed();
        }
    };
}
//  4. Process the final data set (sort, calculate dwell times, diagnostics
var onAllVisitsProcessed = function () {
    chromedata.sort(function (a, b) {
        return parseFloat(a.visitTime) - parseFloat(b.visitTime);
    });
    chromedata.streamgraphDwellCalc();
    chromedata.activeTraceCalc();
    //console.log('Dataset size - prior to SQL queries:', chromedata.length);
    //diagQueries();

};

//========== Diagnostic Queries =================================
function consoleQueryStats(q, raw, desc) {
    var i, avgCount;
    var tmpq;
    var maxCount = Math.max.apply(Math, q.map(function (o) {
        return o.value;
    }));
    var minCount = Math.min.apply(Math, q.map(function (o) {
        return o.value;
    }));
    var totCount = 0;
    for (i = 0; i < q.length; i++) {
        totCount += q[i].value;
    }
    avgCount = totCount / q.length;
    tmpq = alasql("SELECT [key] from ? GROUP BY [key]", [q]);
    console.log("=========================================================================\n");
    console.log(desc + "\t\tDataset size:", q.length, "\tDomains:", tmpq.length);
    console.log("\tStart Date:", timeStamp(raw.startTime()), "\tEnd date:", timeStamp(raw.endTime()), "\t" +
        "Number of days:", ((raw.endTime() - raw.startTime()) / (24 * 60 * 60 * 1000)).toFixed(1));
    console.log("\tHigh:", maxCount, "\tLow:", minCount, "\tTotal:", totCount.toFixed(2), "\t" +
        "Average:", avgCount.toFixed(2));
    console.log("\tQuery:", q);
}

// check status of data (debugging)
function diagQueries() {
    var i, t1, t2;
    console.log("Diagnostic check of data");
    console.log("     Visits: ", chromedata.length);
    console.log("     Earliest visit time: ", timeStamp(chromedata.startTime()));
    t1 = Math.round(((new Date()).getTime() - chromedata.startTime()) / (1000 * 60 * 60));
    t2 = (chromedata.length / t1).toFixed(2);
    console.log("     Total hours:         ", t1);
    console.log("     Visits/hour:         ", t2);
    console.log(chromedata);
    var q1, q2, q3, q4, q5, q6, q7, q8, q9;
    q1 = alasql("SELECT * FROM ? GROUP BY url", [chromedata]);
    console.log("\tUnique urls ", q1.length);
    q2 = alasql("SELECT * FROM ? GROUP BY domain", [chromedata]);
    console.log("\tUnique domains ", q2.length);
    q3 = alasql("SELECT * FROM ? GROUP BY shortDomain", [chromedata]);
    console.log("\tUnique shortDomains ", q3.length);
    q4 = alasql("SELECT * FROM ? WHERE transition = 'link' GROUP BY shortDomain", [chromedata]);
    console.log("\tUnique transition 'link' grouped by shortDomain", q4.length);
    q5 = alasql("SELECT * FROM ? WHERE transition = 'typed' GROUP BY shortDomain", [chromedata]);
    console.log("\tUnique transition 'typed' grouped by shortDomain", q5.length);
    q6 = alasql("SELECT transition, COUNT(visitCount) AS total FROM ?  GROUP BY transition", [chromedata]);
    for (i = 0; i < q6.length; i++) {
        console.log("\tTransition type:", q6[i]);
    }
    q7 = alasql("SELECT * FROM ? ORDER by dwellTime DESC", [chromedata]);
    console.log("\tDwell Times Max hours: ", (q7[0].dwellTime).toFixed(0));
    for (i = 0; i < 10; i++) {
        console.log("\t\tDwelltimes:", q7[i].domain, ":", (q7[i].dwellTime).toFixed(4), "hours");
    }
    console.log(q7);
    q8 = alasql("SELECT shortDomain AS domain, ROUND(SUM(dwellTime),2) AS dwellHours, SUM(visitCount) AS visits " +
        "FROM ? GROUP BY shortDomain ORDER BY visits DESC", [chromedata]);
    console.log("\tDwell time add Visits Highlights: ", q8);
    q9 = alasql("SELECT shortDomain FROM ? WHERE LEN(shortDomain)>15 " +
        "GROUP BY shortDomain ORDER BY LEN(shortDomain) DESC", [chromedata]);
    console.log(q9);
}
//======== HELPER FUNCTIONS =======================
function fillGaps(q, start, end, name, rank) {
    var t = new Date(start);
    while (t <= end + (24 * 60 * 60 * 1000)) {
        q.push({"date": dateStamp(t), "key": name, "value": 0, "rank": rank});
        t.setDate(t.getDate() + 1);
    }
}

// merge two objects
function extend(obj, src) {
    for (var key in src) {
        if (src.hasOwnProperty(key)) {
            obj[key] = src[key];
        }
    }
    return obj;
}

// Convert js timestamp to formatted string https://gist.github.com/hurjas/266048
function timeStamp(dateVal) {
    var i;
    var t = new Date(dateVal);
    var date = [t.getMonth() + 1, t.getDate(), t.getFullYear()];
    var time = [t.getHours(), t.getMinutes(), t.getSeconds()];
    var suffix = ( time[0] < 12 ) ? "AM" : "PM";
    time[0] = ( time[0] < 12 ) ? time[0] : time[0] - 12;
    time[0] = time[0] || 12;
    for (i = 1; i < 3; i++) {
        if (time[i] < 10) {
            time[i] = "0" + time[i];
        }
    }
    return date.join("/") + " " + time.join(":") + " " + suffix;
}

//converts timestamp to HH:MM format
function timeOfDay(dateVal) {
    var i;
    var t = new Date(dateVal);
    var time = [t.getHours(), t.getMinutes()];
    for (i = 1; i < 2; i++) {
        if (time[i] < 10) {
            time[i] = "0" + time[i];
        }
    }
    return time.join(":");
}

function dateStamp(dateVal) {
    var i;
    var t = new Date(dateVal);
    var date = [t.getMonth() + 1, t.getDate(), t.getFullYear() - 2000];
    for (i = 0; i < 2; i++) {
        if (date[i] < 10) {
            date[i] = "0" + date[i];
        }
    }
    return date.join("/");
}

// returns (days-1)*msecIn a Day PLUS msec since midnite
//used by activeTrace to return partial day results
function msecSinceDay(days) {
    var t = new Date();
    //get whole days of msec for anything over 1 day long
    var n = (days - 1) * 24 * 60 * 60 * 1000;
    //drop t.getSeconds() for performance
    var m = ((t.getHours() * 60 * 60) + (t.getMinutes() * 60)) * 1000;
    return t - (n + m);
}

//extract domain from URL
function urlDomain(data) {
    var a = document.createElement('a');
    a.href = data;
    //a.hostname = a.hostname.replace("www.","");
    return a.hostname;
}

function prettyDomain(str) {  // make domain short and sweet
    //there are thousands of these...
    var topLevelDomains = [".com", ".edu", ".gov", ".org", ".net", ".int", ".mil", ".arpa", ".io", ".tv"];
    var resStr = str.replace("www.", "");
    topLevelDomains.forEach(function (e) {
        resStr = resStr.replace(e, "");
    });
    return resStr;
}

//this is sample data to test the integration with the D3 module
testQuery.pq = [
    {key: "192.168.1.52", value: 0.1, date: "01/08/13"},
    {key: "192.168.1.52", value: 0.15, date: "01/09/13"},
    {key: "192.168.1.52", value: 0.35, date: "01/10/13"},
    {key: "192.168.1.52", value: 0.38, date: "01/11/13"},
    {key: "192.168.1.52", value: 0.22, date: "01/12/13"},
    {key: "192.168.1.52", value: 0.16, date: "01/13/13"},
    {key: "192.168.1.52", value: 0.07, date: "01/14/13"},
    {key: "192.168.1.52", value: 0.02, date: "01/15/13"},
    {key: "192.168.1.52", value: 0.17, date: "01/16/13"},
    {key: "192.168.1.52", value: 0.33, date: "01/17/13"},
    {key: "192.168.1.52", value: 0.4, date: "01/18/13"},
    {key: "192.168.1.52", value: 0.32, date: "01/19/13"},
    {key: "192.168.1.52", value: 0.26, date: "01/20/13"},
    {key: "192.168.1.52", value: 0.35, date: "01/21/13"},
    {key: "192.168.1.52", value: 0.4, date: "01/22/13"},
    {key: "192.168.1.52", value: 0.32, date: "01/23/13"},
    {key: "192.168.1.52", value: 0.26, date: "01/24/13"},
    {key: "192.168.1.52", value: 0.22, date: "01/25/13"},
    {key: "192.168.1.52", value: 0.16, date: "01/26/13"},
    {key: "192.168.1.52", value: 0.22, date: "01/27/13"},
    {key: "192.168.1.52", value: 0.1, date: "01/28/13"},
    {key: "docs.google.com", value: 0.35, date: "01/08/13"},
    {key: "docs.google.com", value: 0.36, date: "01/09/13"},
    {key: "docs.google.com", value: 0.37, date: "01/10/13"},
    {key: "docs.google.com", value: 0.22, date: "01/11/13"},
    {key: "docs.google.com", value: 0.24, date: "01/12/13"},
    {key: "docs.google.com", value: 0.26, date: "01/13/13"},
    {key: "docs.google.com", value: 0.34, date: "01/14/13"},
    {key: "docs.google.com", value: 0.21, date: "01/15/13"},
    {key: "docs.google.com", value: 0.18, date: "01/16/13"},
    {key: "docs.google.com", value: 0.45, date: "01/17/13"},
    {key: "docs.google.com", value: 0.32, date: "01/18/13"},
    {key: "docs.google.com", value: 0.35, date: "01/19/13"},
    {key: "docs.google.com", value: 0.3, date: "01/20/13"},
    {key: "docs.google.com", value: 0.28, date: "01/21/13"},
    {key: "docs.google.com", value: 0.27, date: "01/22/13"},
    {key: "docs.google.com", value: 0.26, date: "01/23/13"},
    {key: "docs.google.com", value: 0.15, date: "01/24/13"},
    {key: "docs.google.com", value: 0.3, date: "01/25/13"},
    {key: "docs.google.com", value: 0.35, date: "01/26/13"},
    {key: "docs.google.com", value: 0.42, date: "01/27/13"},
    {key: "docs.google.com", value: 0.42, date: "01/28/13"},
    {key: "Gmail", value: 0.21, date: "01/08/13"},
    {key: "Gmail", value: 0.25, date: "01/09/13"},
    {key: "Gmail", value: 0.27, date: "01/10/13"},
    {key: "Gmail", value: 0.23, date: "01/11/13"},
    {key: "Gmail", value: 0.24, date: "01/12/13"},
    {key: "Gmail", value: 0.21, date: "01/13/13"},
    {key: "Gmail", value: 0.35, date: "01/14/13"},
    {key: "Gmail", value: 0.39, date: "01/15/13"},
    {key: "Gmail", value: 0.4, date: "01/16/13"},
    {key: "Gmail", value: 0.36, date: "01/17/13"},
    {key: "Gmail", value: 0.33, date: "01/18/13"},
    {key: "Gmail", value: 0.43, date: "01/19/13"},
    {key: "Gmail", value: 0.4, date: "01/20/13"},
    {key: "Gmail", value: 0.34, date: "01/21/13"},
    {key: "Gmail", value: 0.28, date: "01/22/13"},
    {key: "Gmail", value: 0.26, date: "01/23/13"},
    {key: "Gmail", value: 0.37, date: "01/24/13"},
    {key: "Gmail", value: 0.41, date: "01/25/13"},
    {key: "Gmail", value: 0.46, date: "01/26/13"},
    {key: "Gmail", value: 0.47, date: "01/27/13"},
    {key: "Gmail", value: 0.41, date: "01/28/13"},
    {key: "yahoo", value: 0.1, date: "01/08/13"},
    {key: "yahoo", value: 0.15, date: "01/09/13"},
    {key: "yahoo", value: 0.35, date: "01/10/13"},
    {key: "yahoo", value: 0.38, date: "01/11/13"},
    {key: "yahoo", value: 0.22, date: "01/12/13"},
    {key: "yahoo", value: 0.16, date: "01/13/13"},
    {key: "yahoo", value: 0.07, date: "01/14/13"},
    {key: "yahoo", value: 0.02, date: "01/15/13"},
    {key: "yahoo", value: 0.17, date: "01/16/13"},
    {key: "yahoo", value: 0.33, date: "01/17/13"},
    {key: "yahoo", value: 0.4, date: "01/18/13"},
    {key: "yahoo", value: 0.32, date: "01/19/13"},
    {key: "yahoo", value: 0.26, date: "01/20/13"},
    {key: "yahoo", value: 0.35, date: "01/21/13"},
    {key: "yahoo", value: 0.4, date: "01/22/13"},
    {key: "yahoo", value: 0.32, date: "01/23/13"},
    {key: "yahoo", value: 0.26, date: "01/24/13"},
    {key: "yahoo", value: 0.22, date: "01/25/13"},
    {key: "yahoo", value: 0.16, date: "01/26/13"},
    {key: "yahoo", value: 0.22, date: "01/27/13"},
    {key: "yahoo", value: 0.1, date: "01/28/13"},
    {key: "github", value: 0.1, date: "01/08/13"},
    {key: "github", value: 0.15, date: "01/09/13"},
    {key: "github", value: 0.35, date: "01/10/13"},
    {key: "github", value: 0.38, date: "01/11/13"},
    {key: "github", value: 0.22, date: "01/12/13"},
    {key: "github", value: 0.16, date: "01/13/13"},
    {key: "github", value: 0.07, date: "01/14/13"},
    {key: "github", value: 0.02, date: "01/15/13"},
    {key: "github", value: 0.17, date: "01/16/13"},
    {key: "github", value: 0.33, date: "01/17/13"},
    {key: "github", value: 0.4, date: "01/18/13"},
    {key: "github", value: 0.32, date: "01/19/13"},
    {key: "github", value: 0.26, date: "01/20/13"},
    {key: "github", value: 0.35, date: "01/21/13"},
    {key: "github", value: 0.4, date: "01/22/13"},
    {key: "github", value: 0.32, date: "01/23/13"},
    {key: "github", value: 0.26, date: "01/24/13"},
    {key: "github", value: 0.22, date: "01/25/13"},
    {key: "github", value: 0.16, date: "01/26/13"},
    {key: "github", value: 0.22, date: "01/27/13"},
    {key: "github", value: 0.1, date: "01/28/13"},
    {key: "moodle.cs.colorado", value: 0.1, date: "01/08/13"},
    {key: "moodle.cs.colorado", value: 0.15, date: "01/09/13"},
    {key: "moodle.cs.colorado", value: 0.35, date: "01/10/13"},
    {key: "moodle.cs.colorado", value: 0.38, date: "01/11/13"},
    {key: "moodle.cs.colorado", value: 0.22, date: "01/12/13"},
    {key: "moodle.cs.colorado", value: 0.16, date: "01/13/13"},
    {key: "moodle.cs.colorado", value: 0.07, date: "01/14/13"},
    {key: "moodle.cs.colorado", value: 0.02, date: "01/15/13"},
    {key: "moodle.cs.colorado", value: 0.17, date: "01/16/13"},
    {key: "moodle.cs.colorado", value: 0.33, date: "01/17/13"},
    {key: "moodle.cs.colorado", value: 0.4, date: "01/18/13"},
    {key: "moodle.cs.colorado", value: 0.32, date: "01/19/13"},
    {key: "moodle.cs.colorado", value: 0.26, date: "01/20/13"},
    {key: "moodle.cs.colorado", value: 0.35, date: "01/21/13"},
    {key: "moodle.cs.colorado", value: 0.4, date: "01/22/13"},
    {key: "moodle.cs.colorado", value: 0.32, date: "01/23/13"},
    {key: "moodle.cs.colorado", value: 0.26, date: "01/24/13"},
    {key: "moodle.cs.colorado", value: 0.22, date: "01/25/13"},
    {key: "moodle.cs.colorado", value: 0.16, date: "01/26/13"},
    {key: "moodle.cs.colorado", value: 0.22, date: "01/27/13"},
    {key: "moodle.cs.colorado", value: 0.1, date: "01/28/13"}
];


