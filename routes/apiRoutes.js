var db = require("../models");
var moment = require("moment");
var axios = require("axios");
axios.defaults.headers.common.Authorization = process.env.SABRE_TOKEN;

module.exports = function(app)
{
  app.post("/api/destination", function(req, res)
  {
    var clientInput = req.body;
    var clientOutput = [];
    var fareObj = {};
    requestStr = getFareRequest(clientInput);

    axios
      .get(requestStr)
      .then(function(result)
      {
        var allFares = result.data.FareInfo; // from API

        var airportCodes = [];
        for (fare in allFares)
        {airportCodes.push(allFares[fare].DestinationLocation);} // 'BOS'

        db.Airport.findAll(
          {
            attributes: ['airport', 'code'],
            where: {code: airportCodes}
          })
          .then(function(dbAirports)
          {
            for (fare in allFares) // for all fares from API
            {
              var curDestination = allFares[fare].DestinationLocation;
              var airportRow = dbAirports.find(function(airportItem)
              {
                return airportItem.dataValues.code === curDestination;
              });
              fareObj =
                    {
                      destination: airportRow.airport,
                      destinationCode: allFares[fare].DestinationLocation,
                      fare: allFares[fare].LowestFare.Fare
                    };
              clientOutput.push(fareObj);
            }

            clientOutput.sort(compare);
            res.json(clientOutput);
          });
      })
      .catch(function(err) {
        console.log("*************************************************************");
        console.log(err);
      });
  });

  app.post("/api/trends", function(req, res)
  {
    var clientInput = req.body;
    var chartOutput = {historical: [], forecast: {}};

    // get historical data
    getChartHistorical(clientInput, function(historicalResult)
    {
      chartOutput.historical = historicalResult;

      // get future data next
      getChartForecast(clientInput, function(forecastResult)
      {
        chartOutput.forecast = forecastResult;
        res.json(chartOutput);
      });
    });
  });
};

function getChartHistorical(clientInput, cb)
{
    console.log("REQUEST STRING");
    console.log(clientInput);
  var requestStr = getTrendRequest(clientInput, true);
  axios
    .get(requestStr)
    .then(function(historicalResult)
    {
      var promises = [];
      var historicalData = historicalResult.data;
      var origin = historicalData.OriginLocation;
      var destination = historicalData.DestinationLocation;
      var historicalFares = historicalData.FareInfo;
      for (var row=0; row<historicalFares.length; row++)
      {
        var airfare = historicalFares[row].LowestFare;
        var date = historicalFares[row].ShopDateTime;

        promises.push(db.Chart.findOrCreate(
          {
            defaults:
                {
                  date: date,
                  originCity: origin,
                  destinationCity: destination,
                  airfare: airfare
                },
            where:
                {
                  date: date,
                  originCity: origin,
                  destinationCity: destination
                }
          })
          .then(function(historicalRow, wasCreated)
          {
            if (!wasCreated)
            {
              promises.push(db.Chart.update(
                {
                  airfare: airfare,
                },
                {
                  where:
                    {
                        date: date, // this is the date that the historical data was "shopped"
                        originCity: origin,
                        destinationCity: destination
                    }
                }));
            }
          }));
      }
      Promise.all(promises)
        .then(function()
        {
          db.Chart.findAll({
              where: {originCity: origin, destinationCity: destination},
              order:
                [
                    ['date', 'ASC'],
                ]})
            .then(function(allHistorical)
            {
              var historicalArray = [];
              // HEADER ROW
              var record = ["Date", "Price"];
              historicalArray.push(record);

              // DATA ROWS
              for (historicalRow in allHistorical)
              {
                var currentRow = allHistorical[historicalRow].dataValues;
                var rowDate = moment(currentRow.date).format('MM/DD');
                record = [rowDate, currentRow.airfare];
                historicalArray.push(record);
              }
              cb(historicalArray);
            });
        })
        .catch(function(err)
        {
          console.log(err);
          cb(err);
        });
    })
    .catch(function (err)
    {
      console.log(err);
      cb(err);
    });
}

function getChartForecast(clientInput, cb)
{
  requestStr = getTrendRequest(clientInput, false);
  axios
    .get(requestStr)
    .then(function(forecastResult)
    {
      var forecastData = forecastResult.data;
      var forecastOutput =
        {
          origin: forecastData.OriginLocation,
          destination: forecastData.DestinationLocation,
          start: forecastData.DepartureDateTime,
          end: forecastData.ReturnDateTime,
          recommendation: forecastData.Recommendation,
          fare: forecastData.LowestFare,
          trend: forecastData.Direction
        };
      cb(forecastOutput);
    })
    .catch(function(err)
    {
      console.log(err);
    });
}

function getTrendRequest(clientInput, historical)
{

  var start = clientInput.from;
  var end = clientInput.to;
  var home = clientInput.departure;
  var destination = clientInput.destination;
  var url = "https://api-crt.cert.havail.sabre.com";
  var endpoint = "";

  if (historical)
  {
    endpoint = "/v1/historical/shop/flights/fares?";
  }
  else
  {
    endpoint = "/v2/forecast/flights/fares?";
  }

  var requestStr =
    url + endpoint +
    "origin=" + home +
    "&destination=" + destination +
    "&departuredate=" + start +
    "&returndate=" + end;

  return requestStr;
}

function getFareRequest(clientInput)
{
  var start = clientInput.from;
  var end = clientInput.to;
  var home = clientInput.departure;
  var theme = clientInput.activity;

  var requestStr =
    "https://api-crt.cert.havail.sabre.com/v2/shop/flights/fares?" +
    "origin=" + home +
    "&departuredate=" + start +
    "&returndate=" + end +
    "&theme=" + theme;

  return requestStr;
}

function compare(fare1, fare2)
{
  if (fare1.fare > fare2.fare) {return 1;}
  if (fare2.fare > fare1.fare) {return -1;}
  return 0;
}
