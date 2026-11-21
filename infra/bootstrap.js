module.exports.handler = async () => ({
  statusCode: 503,
  body: JSON.stringify({ message: 'Run npm run deploy:apps' }),
});
