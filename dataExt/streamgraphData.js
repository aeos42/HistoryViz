/*
 * Core API history strategy was based on mechanism used here:
 * https://chromium.googlesource.com/chromium/src/+/master/chrome/common
 *                                  /extensions/docs/examples/api/history/showHistory/typedUrls.js
 */

/* Overall strategy
 *  1. Setup listener for D3 visualizations
 *  2. Call chrome.history and chrome.visits with callback functions
 *  3. Augment any data items, 'join' history and visit data and push to data array
 *  4. Process the final data set (sort, calculate dwell times, diagnostics
 *  5. Build alaSQL query results for D3 operations
 */

// ====== TopVisits parameters =======
const topVisitsMaxDomains = 35;
// ====== WordCloud parameters ========
const wordcloudMaxWords = 30;
// ====== Time of Day parameters =======
//# min in each interval
const timeInterval = 15;
// ====== streamgraph parameters ======
//0 - all history, otherwise number of days of history
const streamgraphNumDays = 30;
const streamgraphMaxDomains = 100;
var dwellTimeOn;
//stop counting dwelltime after this limit
const maxDwellHours = 4;

// ==== Active trace testing variables ===========================
//we might reduce later to improve performance
const activeTraceMaxDataItems = 100000;

/* this will return whole days of info and up to the current time for today.
 * so if you select 1, a partial day of data is returned and the last start time
 * will be close to the current time that you ran the query.
 * We also set the end time to be 23:59 if the end time goes into the next calendar day.
 * This enforces a rule that start time is always the same or less than the end time.
 */
const activeTraceNumDays = 1;

/* how many domains of data are represented in the result
 * you need to select at least 1 to get any data
 * these are sorted to return domains with the top total dwell time
 * over the time frame selected
 */
const activeTraceMaxDomains = 100;

/* smallest size window that you want returned
 * measured in hours i.e .0833 = 5 min .01667 = 1 min
 * if you use 0 you will see windows where start time and end times are identical
 */
const activeTraceMinWindow = 0.017;
//============================================================

var streamgraphSearchStartTime =
    (streamgraphNumDays === 0 ? 0 : (new Date()).getTime() - (24 * 60 * 60 * 1000) * streamgraphNumDays);
var queryStartTimeActiveTrace = (streamgraphNumDays === 0 ? 0 : msecSinceDay(activeTraceNumDays));

//var searchStartTime = streamgraphSearchStartTime;
var searchStartTime = Math.min(streamgraphSearchStartTime, streamgraphSearchStartTime);

//return responses
var testQuery = {pq: [], numdays: streamgraphNumDays, maxDomains: streamgraphMaxDomains};

var streamgraphDwell = {pq: [], numdays: streamgraphNumDays, maxDomains: streamgraphMaxDomains};
//magic - how long did we linger?
streamgraphDwell.calculate = function () {
    var i, dwell, len;
    //console.time("Calculate: dwell");
    for (i = 0, len = chromedata.length - 1; i < len; i++) {
        dwell = chromedata[i + 1].visitTime - chromedata[i].visitTime;
        //this is stored as hours
        chromedata[i].dwellTime = Math.min(maxDwellHours, dwell / 3600 / 1000);
    }
    // last visit has no dwell time
    chromedata[chromedata.length - 1].dwellTime = 0;
    //console.timeEnd("Calculate: dwell");
};
streamgraphDwell.query = function () {
    console.time("alaSQL streamgraph dwell query");
    var pq6 = alasql("SELECT domain, SUM(dwellTime) AS [value], ROWNUM() AS rank FROM ? " +
        //   "WHERE (LENGTH(shortDomain) <= 30) " +
        "GROUP BY domain ORDER BY [value] DESC LIMIT " + streamgraphMaxDomains.toString(), [chromedata]);

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
};

var streamgraphVisits = {pq: [], numdays: streamgraphNumDays, maxDomains: streamgraphMaxDomains};
streamgraphVisits.query = function () {
    console.time("alaSQL streamgraph visits query");
    var pq6 = alasql("SELECT domain, COUNT(*) AS [value], ROWNUM() AS rank FROM ? " +
        "GROUP BY domain ORDER BY [value] DESC LIMIT " + streamgraphMaxDomains.toString(), [chromedata]);

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
    //consoleQueryStats(this.pq, chromedata, "alaSQL Visits Query");
    console.timeEnd("alaSQL streamgraph visits query");
};

var activeTrace = {hourdata: [], timestampdata: []};
activeTrace.calculate = function () {
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
activeTrace.query = function () { //Active Trace Query
    console.time("alaSQL activeTrace query: ");
    var pq6 = alasql("SELECT domain, SUM(dwellTime) AS [value] FROM ? " +
        "WHERE ((dwellTime > " + activeTraceMinWindow + " ) AND (visitTime >  " + queryStartTimeActiveTrace + ")) " +
        "GROUP BY domain ORDER BY [value] DESC LIMIT " + activeTraceMaxDomains.toString(), [chromedata]);

    var pq2 = alasql("SELECT domain as urlName, visitStartTime AS [start], visitEndTime AS [end] FROM ? " +
        "JOIN ? AS pq6 USING domain " +
        "WHERE ((dwellTime > " + activeTraceMinWindow + " ) AND (visitTime >  " + queryStartTimeActiveTrace + ")) " +
        "ORDER BY start ASC LIMIT " + activeTraceMaxDataItems.toString(), [chromedata, pq6]);

    var pq3 = alasql("SELECT domain as urlName, visitStartTimeStamp AS [start], visitEndTimeStamp AS [end] FROM ? " +
        "JOIN ? AS pq6 USING domain " +
        "WHERE ((dwellTime > " + activeTraceMinWindow + " ) AND (visitTime >  " + queryStartTimeActiveTrace + ")) " +
        "ORDER BY start ASC LIMIT " + activeTraceMaxDataItems.toString(), [chromedata, pq6]);
    //consoleQueryStats(pq2, chromedata, "alaSQL HH:MM - Active Trace data by domain, start and end");
    //consoleQueryStats(pq3, chromedata, "alaSQL XX/XX/XX HH:MM - Active Trace data by domain, start and end");
    this.hourdata = pq2;
    this.timestampdata = pq3;
    console.timeEnd("alaSQL activeTrace query: ");
};

//timeOfDay return data
var tod = {timeSlot: []};
// Increment the rate count for each visit found (in timeslot array)
tod.calculate = function () {
    //console.time("Calculate: Time of Day");
    var msec, val, i, index, len;
    var d = new Date();
    //  2. Setup a list of timeslots {time: minutes_since_midnite, rate: 0) for (1440 / timeInterval) slots
    tod.timeSlot = [];
    for (i = 0; i <= (60 * 24) / timeInterval; i++) {
        tod.timeSlot.push({time: (timeInterval * i), rate: 0});
    }

    for (i = 0, len = chromedata.length; i < len; i++) {
        msec = chromedata[i].visitTime;
        d.setTime(msec - (msec % (60 * timeInterval * 1000)));
        val = d.getHours() * 60 + d.getMinutes();
        index = val / timeInterval;
        tod.timeSlot[index].time = val;
        tod.timeSlot[index].rate++;
    }
    //console.timeEnd("Calculate: Time of Day");
};

// WordCloud return data
var wordCloud = {wordList: []};
wordCloud.query = function () {
    console.time("alaSQL wordCloud query: ");
    this.wordList = alasql(
        "SELECT shortDomain AS text, COUNT(*) AS size FROM ? " +
        "WHERE (visitTime >  " + streamgraphSearchStartTime + ") " +
        "GROUP by shortDomain ORDER BY size DESC LIMIT " + wordcloudMaxWords, [chromedata]);
    //console.log(this.wordList);
    console.timeEnd("alaSQL wordCloud query: ");
};

// Top Visits return data
var topVisits = {history: []};
topVisits.query = function () {
    console.time("alaSQL topVisits query: ");
    this.history = alasql(
        "SELECT domain, COUNT(*) AS visits FROM ? " +
        "WHERE (visitTime >  " + streamgraphSearchStartTime + ") " +
        "GROUP by domain ORDER BY visits DESC LIMIT " + topVisitsMaxDomains, [chromedata]);
    //console.log(this.history);
    console.timeEnd("alaSQL topVisits query: ");
};

//main data element - generated from chrome calls - used for all SQL queries
var chromedata = [];
chromedata.startTime = function () {
    return chromedata[0].visitTime;
};
chromedata.endTime = function () {
    return chromedata[chromedata.length - 1].visitTime;
};

//  1. Setup all D3 listeners
chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        refreshChromeData(chromedata.endTime() + 100); //add 100 msec to last captured element
        if (request.greeting === "viz5D3") {
            if (request.graph === "Hours") {
                dwellTimeOn = true;
                streamgraphDwell.query();
                sendResponse(streamgraphDwell);
            }
            else {
                dwellTimeOn = false;
                streamgraphVisits.query();
                sendResponse(streamgraphVisits);
            }
        }
        else if (request.greeting === "activeTraceData") {
            activeTrace.query();
            sendResponse(activeTrace);
        }
        else if (request.greeting === "timeOfDayD3") {
            tod.calculate();
            sendResponse(tod);
        }
        else if (request.greeting === "wordCloudD3") {
            wordCloud.query();
            sendResponse(wordCloud);
        }
        else if (request.greeting === "topVisitsD3") {
            topVisits.query();
            sendResponse(topVisits);
        }
    });

//  2. Call chrome.history and chrome.visits with callback functions
refreshChromeData(searchStartTime);

function refreshChromeData(stime) {
    var numRequestsOutstanding = 0;
    // h -  single record of returned history results
    var h, i, len;
    console.time("Chrome history-search call");
    chrome.history.search({text: "", maxResults: 100000, startTime: stime},
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
    tod.calculate();
    streamgraphDwell.calculate();
    activeTrace.calculate();
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



