const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();

exports.handler = (event, context, callback) => {
  const pathParameters = event.pathParameters;
  const userRouteId = pathParameters.routeId;
  
  
    
    getRouteById(userRouteId)
        .then(dbResults => {
            callback(null, {
                statusCode: 201,
                body: JSON.stringify(dbResults.Item),
                headers: {
                    'Access-Control-Allow-Origin': '*'
                }
            });
        })
        .catch(err => {
            console.log(`Problem getting the route from ${userRouteId}.`);
            console.error(err);
            errorResponse(err.message, context.awsRequestId, callback);
        });
}

function getRouteById(userRouteId){
    return ddb.get({
        TableName: 'routes',
        Key: {
            "routeId": userRouteId
            },
    }).promise();
}

function errorResponse(errorMessage, awsRequestId, callback) {
  callback(null, {
    statusCode: 500,
    body: JSON.stringify({
      Error: errorMessage,
      Reference: awsRequestId,
    }),
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  });
}