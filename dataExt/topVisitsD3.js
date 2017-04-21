// D3 code adapted from http://bl.ocks.org/bceskavich/a9a365467b5e1d2075f6
// Billy Ceskavich's Block
// Using AlaSQL for queries - http://alasql.org/
// test with https://jsfiddle.net/jheil/s6onp5jc/

/* Overall strategy
 *  1. Send message to the listener on background page to send query data
 * 	2. Use alaSQL to select the top n, merged fields, counts and sorted final data
 * 	3. Present the D3 bargraph visualization
 */
var maxDataRows = 35;	//max number of domains to display
var w = 900;
var h = 500;
var numDays = 1;		//0 - all time, 1 - 1 day, 7 - 1 week, 30-30days, etc
var strokecolor = "#000000";

//  1. Send message to the listener on background page to send query data
chrome.runtime.sendMessage({greeting: "topVisitsD3", rows: maxDataRows,
                            sort: "DESC", days: numDays}, function(response) {
	var dataset = response.history;
	//console.log(dataset);

// 	3. Present the D3 bargraph visualization
     // Dimensions for the chart: height, width, and space b/t the bars
	var margins = {top: 10, right: 50, bottom: 200, left: 50};
	var height = h - margins.top - margins.bottom,
		width = w - margins.left - margins.right,
		barPadding = 2;

	//set tooltip area
	var tooltip = d3.select("body")
		.append("div")
		.attr("class", "remove")
		.style("position", "absolute")
		.style("z-index", "20")
		.style("visibility", "hidden")
		.style("top", "60px")
		.style("left", "125px");

	var yScale = d3.scale.linear()
		.domain([0, d3.max(dataset, function(d){return d.visits;})])
		.range([height, 0]);

	var yAxis = d3.svg.axis()
		.scale(yScale)
		.orient('left')
		.ticks(5);

	// Creates a scale for the x-axis based on Domain names
	var xScale = d3.scale.ordinal()
		.domain(dataset.map(function(d){return d.domain;}))
		.rangeRoundBands([0, width], 0.1);

	// Creates an axis based off the xScale properties
	var xAxis = d3.svg.axis()
		.scale(xScale)
		.orient('bottom');

	var svg = d3.select('.main')
		.append('svg')
		.attr('width', width + margins.left + margins.right)
		.attr('height', height + margins.top + margins.bottom)
		.append('g')
			.attr('transform', 'translate(' + margins.left + ',' + margins.top + ')');

	svg.selectAll('rect')
		.data(dataset)
		.enter()
		.append('rect')
			.attr('x', function(d, i){return xScale(d.domain);})
			.attr('y', function(d) {return yScale(d.visits);})
			.attr('width', (width / dataset.length) - barPadding)
			.attr('height', function(d){return height - yScale(d.visits);})
			.attr('fill', 'steelblue')
			.attr('class', function(d){return d.domain;})
			.attr('id', function(d){return d.visits;})
			.on("mouseover", function(d) {
				d3.select(this)
					.classed("hover", true)
				//attr("stroke", strokecolor)
					.attr("stroke-width", "0.5px");
				tooltip.html( "<p>" + d.domain + " - " + d.visits + " visits</p>" ).style("visibility", "visible");
			})

			.on("mouseout", function(d,i) {
				d3.select(this)
					.attr("stroke-width", "0px");
				tooltip.html( "<p>" + d.domain +  " - " + d.visits+ " visits</p>" ).style("visibility", "hidden");
		});

	// Appends the yAxis
	svg.append('g')
		.attr('class', 'axis')
		.attr('transform', 'translate(-10, 0)')
		.call(yAxis);

	// Appends the xAxis
	svg.append('g')
		.attr('class', 'axis')
		.attr('transform', 'translate(0,' + (height + 10) + ')')
		.call(xAxis)
		.selectAll("text")
			.style("text-anchor", "end")
            .attr("dx", "-.3em")
			.attr("dy", ".35em")
			.attr("transform", "rotate(-45)");

	// Adds yAxis title
	svg.append('text')
		.text('Total Visits')
		.attr('transform', 'translate(-70, -20)');
});
