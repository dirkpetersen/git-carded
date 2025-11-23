module.exports = async function (context, req) {
    context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
            USE_MOCK_OAUTH: process.env.USE_MOCK_OAUTH,
            REDIRECT_URI: process.env.REDIRECT_URI,
            NODE_ENV: process.env.NODE_ENV,
            GITHUB_ORG_NAME: process.env.GITHUB_ORG_NAME,
            allEnvVars: Object.keys(process.env).sort()
        }
    };
};
