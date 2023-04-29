const functions = require('firebase-functions');
const express = require('express');
const cookieParser = require('cookie-parser')();
const cors = require('cors')({origin: true});
const puppeteer = require('puppeteer');
const moment = require('moment');

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

const CleanupAndReturn = (cleanupCallBack, returnValue) => {
  cleanupCallBack();
  return returnValue;
};

const MappingSubjectSchedule = (oResult, daysFromSubject, startSlotFromSubject, sumSlotFromSubject, roomFromSubject) => {
  const map = {
    mon: 'Hai',
    tues: 'Ba',
    weds: 'Tư',
    thurs: 'Năm',
    frid: 'Sáu',
    satur: 'Bảy',
  };
  Object.keys(map).forEach((index) => {
    oResult[index] = {};
    oResult[index].subjects = [];
    oResult[index].startSlots = [];
    oResult[index].sumSlots = [];
    oResult[index].rooms = [];
    Object.keys(daysFromSubject).forEach((subject) => {
      daysFromSubject[subject].forEach((day, dIndex) => {
        if (day == map[index]) {
          oResult[index].subjects.push(subject);
          oResult[index].startSlots.push(startSlotFromSubject[subject][dIndex]);
          oResult[index].sumSlots.push(sumSlotFromSubject[subject][dIndex]);
          oResult[index].rooms.push(roomFromSubject[subject][dIndex]);
        }
      });
    });
  });
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

const GetTimeTable = async (page, oResult) => {
  try {
    oResult.ttb = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=thoikhoabieu', {
      waitUntil: 'domcontentloaded',
    });

    const note = await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_lblNote');
    const noteText = await note.evaluate((node) => node.innerText);
    const noteArray = noteText.split(' ');
    let startDate = noteArray[noteArray.length - 1];
    startDate = moment(startDate + '+07:00', 'DD/MM/YYYYZ');
    const startDateJSON = startDate.toISOString();
    const endDateJSON = startDate.add(15, 'w').toISOString();
    oResult.ttb.startDate = startDateJSON;
    oResult.ttb.endDate = endDateJSON;

    const trList = await page.$$('.grid-roll2 > table');
    const subjects = [];
    const daysFromSubject = {};
    const startSlotFromSubject = {};
    const sumSlotFromSubject = {};
    const roomFromSubject = {};
    for (let i = 1; i <= trList.length; i++) {
      const subjectElement = await page.waitForXPath(`/html/body/form/div[3]/div/table/tbody/tr[2]/td/div[3]/div/div[3]/table/tbody/tr[2]/td/div[2]/table[${i}]/tbody/tr/td[2]`);
      const subject = await subjectElement.evaluate((node) => node.innerText);
      subjects.push(subject);

      const daysElement = await page.waitForXPath(`/html/body/form/div[3]/div/table/tbody/tr[2]/td/div[3]/div/div[3]/table/tbody/tr[2]/td/div[2]/table[${i}]/tbody/tr/td[9]`);
      const dayString = await daysElement.evaluate((node) => node.innerText);
      const dayArray = dayString.split('\n');
      daysFromSubject[subject] = [];
      dayArray.forEach((item, index) => {
        daysFromSubject[subject][index] = item;
      });

      const startSlot = await page.waitForXPath(`/html/body/form/div[3]/div/table/tbody/tr[2]/td/div[3]/div/div[3]/table/tbody/tr[2]/td/div[2]/table[${i}]/tbody/tr/td[10]`);
      const startSlotString = await startSlot.evaluate((node) => node.innerText);
      const startSlotArray = startSlotString.split('\n');
      startSlotFromSubject[subject] = [];
      startSlotArray.forEach((item, index) => {
        startSlotFromSubject[subject][index] = item;
      });

      const sumSlot = await page.waitForXPath(`/html/body/form/div[3]/div/table/tbody/tr[2]/td/div[3]/div/div[3]/table/tbody/tr[2]/td/div[2]/table[${i}]/tbody/tr/td[11]`);
      const sumSlotString = await sumSlot.evaluate((node) => node.innerText);
      const sumSlotArray = sumSlotString.split('\n');
      sumSlotFromSubject[subject] = [];
      sumSlotArray.forEach((item, index) => {
        sumSlotFromSubject[subject][index] = item;
      });

      const room = await page.waitForXPath(`/html/body/form/div[3]/div/table/tbody/tr[2]/td/div[3]/div/div[3]/table/tbody/tr[2]/td/div[2]/table[${i}]/tbody/tr/td[12]`);
      const roomString = await room.evaluate((node) => node.innerText);
      const roomArray = roomString.split('\n');
      roomFromSubject[subject] = [];
      roomArray.forEach((item, index) => {
        roomFromSubject[subject][index] = item;
      });
    }

    MappingSubjectSchedule(oResult, daysFromSubject, startSlotFromSubject, sumSlotFromSubject, roomFromSubject);

    return true;
  } catch (error) {
    functions.logger.error('Error while get time table: ', error);
    oResult.error = error;
    return false;
  }
};

const GetScoreAndUser = async (page, oResult) => {
  try {
    oResult.ttb = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemdiemthi', {
      waitUntil: 'domcontentloaded',
    });

    return true;
  } catch (error) {
    functions.logger.error('Error while get score and user info: ', error);
    oResult.error = error;
    return false;
  }
};

const GetTuitionFees = async (page, oResult) => {
  try {
    oResult.ttb = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemhocphi', {
      waitUntil: 'domcontentloaded',
    });

    return true;
  } catch (error) {
    functions.logger.error('Error while get tuition fees: ', error);
    oResult.error = error;
    return false;
  }
};

const GetExamSchedule = async (page, oResult) => {
  try {
    oResult.ttb = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemlichthi', {
      waitUntil: 'domcontentloaded',
    });

    return true;
  } catch (error) {
    functions.logger.error('Error while get exam schedule: ', error);
    oResult.error = error;
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
      res.status(401).json({'Result': 'Login failed! invalid id or password!'});
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
    }
    return;
  }
  res.status(200).json({'Result': 'Login Successfully!'});
});

app.post('/all', async (req, res) => {
  const tool = {browser: {}, page: {}};
  const Result = {error: ''};
  let returnError = 1;
  let isSuccess = false;
  await Init(tool);
  const cleanup = async () => {
    await tool.page.close();
    await tool.browser.close();
  };

  isSuccess = await Login(tool.page, Result, req.body.id, req.body.pass);
  if (!isSuccess) {
    if (Result.error == '') {
      res.status(401).json({'Result': 'Login failed! invalid id or password!'});
      returnError = 0;
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
      returnError = -1;
    }
    return CleanupAndReturn(cleanup, returnError);
  }

  isSuccess = await GetTimeTable(tool.page, Result);
  if (!isSuccess) {
    if (Result.error == '') {
      res.status(401).json({'Result': 'Error while get time table! Should not be occured'});
      returnError = 0;
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
      returnError = -1;
    }
    return CleanupAndReturn(cleanup, returnError);
  }

  isSuccess = await GetScoreAndUser(tool.page, Result);
  if (!isSuccess) {
    if (Result.error == '') {
      res.status(401).json({'Result': 'Error while get score and user info! Should not be occured'});
      returnError = 0;
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
      returnError = -1;
    }
    return CleanupAndReturn(cleanup, returnError);
  }

  isSuccess = await GetExamSchedule(tool.page, Result);
  if (!isSuccess) {
    if (Result.error == '') {
      res.status(401).json({'Result': 'Error while get exam schedule! Should not be occured'});
      returnError = 0;
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
      returnError = -1;
    }
    return CleanupAndReturn(cleanup, returnError);
  }

  isSuccess = await GetTuitionFees(tool.page, Result);
  if (!isSuccess) {
    if (Result.error == '') {
      res.status(401).json({'Result': 'Error while get Tuition Fees! Should not be occured'});
      returnError = 0;
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
      returnError = -1;
    }
    return CleanupAndReturn(cleanup, returnError);
  }

  res.status(200).json(Result);
  return CleanupAndReturn(cleanup, returnError);
});

// This HTTPS endpoint can only be accessed by your Firebase Users.
// Requests need to be authorized by providing an `Authorization` HTTP header
// with value `Bearer <Firebase ID Token>`.
exports.app = functions.runWith({
  timeoutSeconds: 120,
  memory: '4GB',
}).https.onRequest(app);
