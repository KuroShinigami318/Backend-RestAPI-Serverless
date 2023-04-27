const functions = require('firebase-functions');
const express = require('express');
const cookieParser = require('cookie-parser')();
const cors = require('cors')({origin: true});
const puppeteer = require('puppeteer');

const app = express();

// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
admin.initializeApp();

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const validateFirebaseIdToken = async (req, res, next) => {
  functions.logger.log('Check if request is authorized with Firebase ID token');

  if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) &&
        !(req.cookies && req.cookies.__session)) {
    functions.logger.error(
        'No Firebase ID token was passed as a Bearer token in the Authorization header.',
        'Make sure you authorize your request by providing the following HTTP header:',
        'Authorization: Bearer <Firebase ID Token>',
        'or by passing a "__session" cookie.',
    );
    res.status(403).send('Unauthorized');
    return;
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    functions.logger.log('Found "Authorization" header');
    // Read the ID Token from the Authorization header.
    idToken = req.headers.authorization.split('Bearer ')[1];
  } else if (req.cookies) {
    functions.logger.log('Found "__session" cookie');
    // Read the ID Token from cookie.
    idToken = req.cookies.__session;
  } else {
    // No cookie
    res.status(403).send('Unauthorized');
    return;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    functions.logger.log('ID Token correctly decoded', decodedIdToken);
    req.user = decodedIdToken;
    next();
    return;
  } catch (error) {
    functions.logger.error('Error while verifying Firebase ID token:', error);
    res.status(403).send('Unauthorized');
    return;
  }
};

app.use(cors);
app.use(cookieParser);
app.use(validateFirebaseIdToken);
app.get('/hello', (req, res) => {
  // @ts-ignore
  res.status(200).json({'name': `${req.user.name}`});
});

const IsAny = (iConditionToCheck, iListCondiTion) => {
  let result = false;
  iListCondiTion.forEach(
    (current) => {
      if (iConditionToCheck.includes(current)) {
        result = true;
        return;
      }
    });
  return result;
};

const Init = async (oToolObj) => {
  oToolObj.browser = await puppeteer.launch({
    headless: true,
    timeout: 20000,
    ignoreHTTPSErrors: true,
    slowMo: 0,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-sandbox',
      '--no-zygote',
      '--window-size=1280,720',
    ],
  });

  oToolObj.page = await oToolObj.browser.newPage();
  await oToolObj.page.setViewport({width: 1280, height: 720});
  // Change the user agent of the scraper
  await oToolObj.page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
  );
};

const Login = async (page, oError, id, pass) => {
  try {
    await page.goto('http://thongtindaotao.sgu.edu.vn/', {
      waitUntil: 'domcontentloaded',
    });

    // Type into id and password
    await page.type('#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_txtTaiKhoa', id);
    await page.type('#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_txtMatKhau', pass);

    // Wait and click on sign in button
    const loginButtonSelector = '#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_btnDangNhap';
    await page.waitForSelector(loginButtonSelector);
    await page.click(loginButtonSelector);

    const checkCondition = await page.waitForSelector('#ctl00_Header1_Logout1_lbtnLogOut');
    const condition = await checkCondition.evaluate((node) => node.innerText);
    const listCondition = ['Thoát', 'Exit'];

    return IsAny(condition, listCondition);
  } catch (error) {
    functions.logger.error('Error while login: ', error);
    oError.error = error;
    return false;
  }
};

app.post('/login', async (req, res) => {
  const tool = {browser: {}, page: {}};
  const Result = {error: ''};
  await Init(tool);
  const isSuccess = await Login(tool.page, Result, req.body.id, req.body.pass);
  await tool.page.close();
  await tool.browser.close();
  if (!isSuccess) {
    if (Result.error == '') {
      res.status(401).send('Login failed! invalid id or password!');
    } else {
      res.status(401).send(`Fatal Error: ${JSON.stringify(Result.error)}`);
    }
    return;
  }
  res.status(200).send('Login Successfully!');
});

app.post('/tkb', async (req, res) => {
  const tool = {browser: {}, page: {}};
  const Error = {error: ''};
  await Init(tool);
  const isSuccess = await Login(tool.page, Error, req.body.id, req.body.pass);
  if (!isSuccess) {
    await tool.browser.close();
    if (Result.error == '') {
      res.status(401).send('Login failed! invalid id or password!');
    } else {
      res.status(401).send(`Fatal Error: ${JSON.stringify(Result.error)}`);
    }
    return;
  }

  await tool.browser.close();
  res.status(200).json();
});

// This HTTPS endpoint can only be accessed by your Firebase Users.
// Requests need to be authorized by providing an `Authorization` HTTP header
// with value `Bearer <Firebase ID Token>`.
exports.app = functions.runWith({
  timeoutSeconds: 120,
  memory: '512MB' || '2GB',
}).https.onRequest(app);
