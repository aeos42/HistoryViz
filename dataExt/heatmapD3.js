/**
 * @author Julia Heil
 * @fileOverview Display heatmap for user's chrome visit history - based on day of week and time of day
 * <pre>
 *        Uses a chrome history API to retrieve data
 *        Data is gathered by {@link streamgraphData.js} at extension load, and
 *            then incrementally when this page loads/
 *        Displays visits for all entire {@link STREAMGRAPH_NUMDAYS} as if they occured in a single day
 *        If set to 0, then data for entire chrome history file will be displayed.
 *        Data for {@link TOPVISITS_MAX_DOMAINS} is pulled into D3 chart
 *
 * Overall strategy
 *  1. Send message to the listener on background page to send query data
 *  2. Display the Visits by hour of day and day of week  visualization using D3
 *
 * Graph visual:
 * </pre>
 * <img src="./heatmap.png">
 * <pre>
 * See {@link tod}  for data format - use tod.heatmap data element
 * </pre>
 * @see adapted from Tom May's Block {@link http://bl.ocks.org/tjdecke/5558084}
 */

var w = 900;
var h = 430;

//  1. Send message to the listener on background page to send query data
chrome.runtime.sendMessage({greeting: "timeOfDayD3"}, function (response) {

    // Dimensions for the chart: height, width, and space b/t the bars
    var margin = {top: 50, right: 40, bottom: 100, left: 30},
        width = w - margin.left - margin.right,
        height = h - margin.top - margin.bottom,
        gridSize = Math.floor(width / 24),
        legendElementWidth = gridSize * 2,
        buckets = 9,
        colors = ["#fffbd4", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"],
        days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
        times = ["1a", "2a", "3a", "4a", "5a", "6a", "7a", "8a", "9a", "10a", "11a", "12a", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "10p", "11p", "12p"];

    var svg = d3.select("#chart").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    var dayLabels = svg.selectAll(".dayLabel")
        .data(days)
        .enter().append("text")
        .text(function (d) {
            return d;
        })
        .attr("x", 0)
        .attr("y", function (d, i) {
            return i * gridSize;
        })
        .style("text-anchor", "end")
        .attr("transform", "translate(-6," + gridSize / 1.5 + ")")
        .attr("class", function (d, i) {
            return ((i >= 0 && i <= 4) ? "dayLabel mono axis axis-workweek" : "dayLabel mono axis");
        });

    var timeLabels = svg.selectAll(".timeLabel")
        .data(times)
        .enter().append("text")
        .text(function (d) {
            return d;
        })
        .attr("x", function (d, i) {
            return i * gridSize;
        })
        .attr("y", 0)
        .style("text-anchor", "middle")
        .attr("transform", "translate(" + gridSize / 2 + ", -6)")
        .attr("class", function (d, i) {
            return ((i >= 7 && i <= 16) ? "timeLabel mono axis axis-worktime" : "timeLabel mono axis");
        });

    var heatmapChart = function () {
        var data = response.heatmap;
        data.forEach(function(d) {
            d.day = +d.day;
            d.hour = +d.hour;
            d.value = +d.rate;
        });

        var colorScale = d3.scale
            .quantile()
            .domain([0, buckets - 1, d3.max(data, function (d) {
                return d.value;
            })])
            .range(colors);

        var cards = svg.selectAll(".hour")
            .data(data, function (d) {
                return d.day + ':' + d.hour;
            });

        cards.append("title");

        cards.enter().append("rect")
            .attr("x", function (d) {
                return (d.hour - 1) * gridSize;
            })
            .attr("y", function (d) {
                return (d.day - 1) * gridSize;
            })
            .attr("rx", 4)
            .attr("ry", 4)
            .attr("class", "hour bordered")
            .attr("width", gridSize-2)
            .attr("height", gridSize-2)
            .style("fill", colors[0]);

        cards.transition().duration(1000)
            .style("fill", function (d) {
                return colorScale(d.value);
            });

        cards.select("title").text(function (d) {
            return d.value;
        });


        var legend = svg.selectAll(".legend")
            .data([0].concat(colorScale.quantiles()), function (d) {
                return d;
            });

        legend.enter().append("g")
            .attr("class", "legend");

        legend.append("rect")
            .attr("x", function (d, i) {
                return legendElementWidth * i;
            })
            .attr("y", height)
            .attr("width", legendElementWidth)
            .attr("height", gridSize / 2)
            .style("fill", function (d, i) {
                return colors[i];
            });

        legend.append("text")
            .attr("class", "mono")
            .text(function (d) {
                return ">= " + Math.round(d);
            })
            .attr("x", function (d, i) {
                return legendElementWidth * i;
            })
            .attr("y", height + gridSize);



    };

    heatmapChart();

});