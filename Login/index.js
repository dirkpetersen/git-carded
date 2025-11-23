module.exports = async function (context, req) {
    context.log('Login endpoint called - TEST');

    const mockRedirectUrl = `${process.env.REDIRECT_URI || 'http://localhost:7071/api/AuthCallback'}?code=mock-test&state=azure_init`;

    context.res = {
        status: 200,
        body: `Login working! Would redirect to: ${mockRedirectUrl}`
    };
};
