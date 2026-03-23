module.exports = async function (context, req) {
    const azureAd = require('../shared/azure-ad');
    const mockOAuth = require('../shared/mock-oauth');

    if (mockOAuth.MOCK_MODE) {
        const mockRedirectUrl = `${process.env.REDIRECT_URI || 'http://localhost:7071/api/AuthCallback'}?code=mock-test&state=azure_init`;
        context.res = { status: 200, body: `Login working! Would redirect to: ${mockRedirectUrl}` };
        return;
    }

    try {
        const authUrl = azureAd.buildAzureAdAuthUrl('azure_init');
        context.res = {
            status: 302,
            headers: { Location: authUrl }
        };
    } catch (err) {
        context.res = { status: 500, body: err.message };
    }
};
