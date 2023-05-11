const functions = require('firebase-functions');
const express = require('express');
const cookieParser = require('cookie-parser')();
const cors = require('cors')({origin: true});
const puppeteer = require('puppeteer');
const moment = require('moment');
const crypto = require('crypto');

const app = express();

// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
const {Timestamp} = require('firebase-admin/firestore');
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

const validateSupportContentType = (req, res, next) => {
  if (!req.headers['content-type']) {
    functions.logger.error('Header should provide Content-Type');
    res.status(403).send('Header should provide content-type! Did you forget to add Content-Type in header?');
    return;
  }
  const contentType = req.headers['content-type'].split('application/')[1];
  switch (contentType) {
    case 'json':
      next();
      return;
    default:
      functions.logger.error(`Unsupported or Invalid Content-Type! ${contentType}`);
      res.status(403).send('Unsupported or Invalid Content-Type! Pkease contact API Provider.');
      return;
  }
};

app.use(cors);
app.use(cookieParser);
app.use(validateFirebaseIdToken);
app.use(validateSupportContentType);

const sBrowser = {
  instance: '',
  count: 0,
};

/* eslint-disable no-unused-vars */
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
/* eslint-enable no-unused-vars */

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

const mutex = {
  AccquireLock: async (id) => {
    const startTime = new Date();
    const lockRef = admin.firestore().collection('requests').doc(id);
    let isLock = {};
    const checkLock = async () => {
      return await admin.firestore().runTransaction(async (transaction) => {
        return await transaction.get(lockRef).then(async (lockDoc) => {
          const now = Timestamp.fromDate(startTime);
          if (!lockDoc.exists) {
            isLock = false;
            transaction.set(lockRef, {
              accquireLock: true,
              lockAt: now,
            });
            return isLock;
          }
          const lockResult = await lockDoc.get('accquireLock');
          isLock = lockResult;
          const lockAt = await lockDoc.get('lockAt');
          if (now._seconds - lockAt._seconds > 120 && isLock) {
            isLock = false;
            transaction.update(lockRef, {lockAt: now});
            return isLock;
          }
          if (!isLock) {
            transaction.update(lockRef, {
              accquireLock: true,
              lockAt: now,
            });
          }
        });
      });
    };
    do {
      if (Date() - startTime > (118 * 60 * 1000)) {
        console.log('Timeout');
        await mutex.ReleaseLock();
        break;
      }
      await checkLock();
      await mutex.Sleep(1000);
    } while (isLock);
  },
  ReleaseLock: async (id) => {
    const lockRef = admin.firestore().collection('requests').doc(id);
    return admin.firestore().runTransaction(async (transaction) => {
      return transaction.get(lockRef).then(async (lockDoc) => {
        if (lockDoc.exists) {
          transaction.update(lockRef, {accquireLock: false});
        }
      });
    });
  },
  Sleep: (milliseconds) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
};

const Init = async (oToolObj) => {
  if (sBrowser.instance == '') {
    sBrowser.instance = await puppeteer.launch({
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
      ],
    });
  }

  oToolObj.browser = sBrowser;
  sBrowser.count++;

  oToolObj.page = await oToolObj.browser.instance.newPage();
  // Change the user agent of the scraper
  await oToolObj.page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
  );
};

const HasAlreadyLogined = async (page, oError) => {
  try {
    const checkCondition = await page.waitForSelector('#ctl00_Header1_Logout1_lbtnLogOut', {
      timeout: 10000,
    });
    const condition = await checkCondition.evaluate((node) => node.innerText);
    const listCondition = ['Thoát', 'Exit'];
    return IsAny(condition, listCondition);
  } catch (error) {
    functions.logger.error('Error while login: ', error);
    return false;
  }
};

const Login = async (page, oError, id, pass) => {
  try {
    await page.goto('http://thongtindaotao.sgu.edu.vn/', {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_txtTaiKhoa');
    await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_txtMatKhau');
    // Type into id and password
    await page.type('#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_txtTaiKhoa', id);
    await page.type('#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_txtMatKhau', pass);

    // Wait and click on sign in button
    const loginButtonSelector = '#ctl00_ContentPlaceHolder1_ctl00_ucDangNhap_btnDangNhap';
    await page.waitForSelector(loginButtonSelector);
    await Promise.all([
      page.waitForNavigation(),
      page.click(loginButtonSelector),
    ]);

    return await HasAlreadyLogined(page, oError);
  } catch (error) {
    functions.logger.error('Error while login: ', error);
    oError.error = error;
    return false;
  }
};

const GetTimeTable = async (page, oResult) => {
  try {
    oResult.ttb = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=thoikhoabieu&sta=1', {
      waitUntil: 'domcontentloaded',
    });

    const note = await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_lblNote', {
      timeout: 10000,
    });
    const noteText = await note.evaluate((node) => node.innerText);
    const noteArray = noteText.split(' ');
    let startDate = noteArray[noteArray.length - 1];
    startDate = moment(startDate + '+07:00', 'DD/MM/YYYYZ');
    const checkDate = startDate.subtract(3, 'w');
    if (moment().diff(checkDate, 'days') < 0) {
      const option = (await page.$x(
        '//*[@id = "ctl00_ContentPlaceHolder1_ctl00_ddlChonNHHK"]/option[2]',
      ))[0];
      const value = await option.evaluate((node) => node.value);
      await Promise.all([
        page.waitForNavigation(),
        page.select('#ctl00_ContentPlaceHolder1_ctl00_ddlChonNHHK', value),
      ]);
      const note = await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_lblNote', {
        timeout: 10000,
      });
      const noteText = await note.evaluate((node) => node.innerText);
      const noteArray = noteText.split(' ');
      startDate = noteArray[noteArray.length - 1];
      startDate = moment(startDate + '+07:00', 'DD/MM/YYYYZ');
    }
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
    oResult.user = {};
    oResult.score = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemdiemthi', {
      waitUntil: 'domcontentloaded',
    });

    const name = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_ucThongTinSV_lblTenSinhVien', (node) => node.innerText);
    oResult.user.studentName = name;
    const major = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_ucThongTinSV_lbNganh', (node) => node.innerText);
    oResult.user.major = major;
    const department = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_ucThongTinSV_lblKhoa', (node) => node.innerText);
    oResult.user.department = department;
    const Cohort = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_ucThongTinSV_lblKhoaHoc', (node) => node.innerText);
    oResult.user.Cohort = Cohort;
    const advisor = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_ucThongTinSV_lblCVHT', (node) => node.innerText);
    oResult.user.advisor = advisor;

    const table = await page.$$('.view-table');
    const scoreRowsEle = await table[0].$$('.row-diemTK');
    const scoreRowslen = scoreRowsEle.length;
    const creditsString = await scoreRowsEle[scoreRowslen - 1].evaluate((node) => node.innerText);
    const accumulatedAverageMark4String = await scoreRowsEle[scoreRowslen - 3].evaluate((node) => node.innerText);
    const accumulatedAverageMarkString = await scoreRowsEle[scoreRowslen - 4].evaluate((node) => node.innerText);
    const credits = creditsString.split(':')[1];
    const accumulatedAverageMark4 = accumulatedAverageMark4String.split(':')[1];
    const accumulatedAverageMark = accumulatedAverageMarkString.split(':')[1];
    oResult.score.credits = credits;
    oResult.score.accumulatedAverageMark4 = accumulatedAverageMark4;
    oResult.score.accumulatedAverageMark = accumulatedAverageMark;

    return true;
  } catch (error) {
    functions.logger.error('Error while get score and user info: ', error);
    oResult.error = error;
    return false;
  }
};

const GetTuitionFees = async (page, oResult, id, pass) => {
  try {
    oResult.fees = {};

    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemhocphi', {
      waitUntil: 'domcontentloaded',
    });

    if (!await HasAlreadyLogined(page, oResult)) {
      console.log('trying login again');
      await Login(page, oResult, id, pass);
      await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemhocphi', {
        waitUntil: 'domcontentloaded',
      });
    }

    await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_lblConNoHocKy', {
      timeout: 10000,
    });
    const payableFee = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_lblConNoHocKy', (node) => node.innerText);
    oResult.fees.payableFee = payableFee;
    const paidFee = await page.$eval('#ctl00_ContentPlaceHolder1_ctl00_lblDaDongHKOffline', (node) => node.innerText);
    oResult.fees.paidFee = paidFee;

    return true;
  } catch (error) {
    functions.logger.error('Error while get tuition fees: ', error);
    return false;
  }
};

const GetExamSchedule = async (page, oResult, id, pass) => {
  try {
    await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemlichthi', {
      waitUntil: 'domcontentloaded',
    });

    if (!await HasAlreadyLogined(page, oResult)) {
      console.log('trying login again');
      await Login(page, oResult, id, pass);
      await page.goto('http://thongtindaotao.sgu.edu.vn/default.aspx?page=xemlichthi', {
        waitUntil: 'domcontentloaded',
      });
    }

    const table = await page.waitForSelector('#ctl00_ContentPlaceHolder1_ctl00_gvXem', {
      timeout: 10000,
    });

    oResult.examSchedule = {};
    oResult.examSchedule.subjects = [];
    oResult.examSchedule.examDates = [];
    oResult.examSchedule.startTimes = [];
    oResult.examSchedule.rooms = [];

    const trArray = await table.$$('tr');
    const trLength = trArray.length;
    for (let i = 1; i < trLength; i++) {
      const subject = await trArray[i].$eval(`#ctl00_ContentPlaceHolder1_ctl00_gvXem_ctl0${i + 1}_lblTenMonHoc`, (node) => node.innerText);
      const examDate = await trArray[i].$eval(`#ctl00_ContentPlaceHolder1_ctl00_gvXem_ctl0${i + 1}_lblNgayThi`, (node) => node.innerText);
      const startTime = await trArray[i].$eval(`#ctl00_ContentPlaceHolder1_ctl00_gvXem_ctl0${i + 1}_lblTietBD`, (node) => node.innerText);
      const room = await trArray[i].$eval(`#ctl00_ContentPlaceHolder1_ctl00_gvXem_ctl0${i + 1}_lblTenPhong`, (node) => node.innerText);
      oResult.examSchedule.subjects.push(subject);
      oResult.examSchedule.examDates.push(examDate);
      oResult.examSchedule.startTimes.push(startTime);
      oResult.examSchedule.rooms.push(room);
    }

    return true;
  } catch (error) {
    functions.logger.error('Error while get exam schedule: ', error);
    return false;
  }
};

app.post('/login', async (req, res) => {
  const startTime = new Date();
  const checkCleanup = {isAlreadyCleaned: false};
  const body = req.body;
  const id = body.id;
  const pass = decryptAES(body.pass);
  await mutex.AccquireLock(id);
  const cleanupCallBack = async () => {
    if (!checkCleanup.isAlreadyCleaned) {
      await mutex.ReleaseLock(id);
      await tool.page.close();
      tool.browser.count--;
      if (tool.browser.count == 0) {
        await tool.browser.instance.close();
        tool.browser.instance = '';
      }
      checkCleanup.isAlreadyCleaned = true;
      if (Date() - startTime > 118 * 60 * 1000) {
        res.status(401).json({'Result': 'Timeout exceed cause server is busy in processing another requests'});
      }
    }
  };
  setTimeout(cleanupCallBack, 118 * 60 * 1000);
  const tool = {browser: {}, page: {}};
  const Result = {error: ''};
  await Init(tool);
  const isSuccess = await Login(tool.page, Result, id, pass);
  await cleanupCallBack();
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
  const startTime = new Date();
  const checkCleanup = {isAlreadyCleaned: false};
  const body = req.body;
  const id = body.id;
  const pass = decryptAES(body.pass);
  await mutex.AccquireLock(id);
  const tool = {browser: {}, page: {}};
  const Result = {error: ''};
  let returnError = 1;
  let isSuccess = false;
  const cleanup = async () => {
    if (!checkCleanup.isAlreadyCleaned) {
      await mutex.ReleaseLock(id);
      await tool.page.close();
      tool.browser.count--;
      if (tool.browser.count == 0) {
        await tool.browser.instance.close();
        tool.browser.instance = '';
      }
      checkCleanup.isAlreadyCleaned = true;
      if (Date() - startTime > 118 * 60 * 1000) {
        res.status(401).json({'Result': 'Timeout exceed cause server is busy in processing another requests'});
      }
    }
  };
  setTimeout(cleanup, 118 * 60 * 1000);
  await Init(tool);
  isSuccess = await Login(tool.page, Result, id, pass);
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
      res.status(401).json({'Result': 'Error while get time table! Should not be occured. Maybe there\'s nothing'});
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
      res.status(401).json({'Result': 'Error while get score and user info! Should not be occured. Maybe there\'s nothing'});
      returnError = 0;
    } else {
      res.status(401).json({'Result': `Fatal Error: ${JSON.stringify(Result.error)}`});
      returnError = -1;
    }
    return CleanupAndReturn(cleanup, returnError);
  }
  Result.user.studentCode = id;

  isSuccess = await GetExamSchedule(tool.page, Result, id, pass);

  isSuccess = await GetTuitionFees(tool.page, Result, id, pass);

  res.status(200).json(Result);
  return CleanupAndReturn(cleanup, returnError);
});

const decryptAES = (ciphertext) => {
  const keyBytes = Buffer.from([71, 196, 224, 77, 66, 145, 169, 76, 2, 133, 239, 154, 57, 226, 248, 133]);
  const nonce = Buffer.from([215, 6, 250, 248, 50, 225, 252, 129, 78, 248, 178, 28, 93, 245, 154, 246]);
  const ciphertextBytes = Buffer.from(ciphertext);
  const cipher = crypto.createDecipheriv(
    'aes-128-ctr',
    keyBytes,
    nonce,
  );

  let decrypted = cipher.update(ciphertextBytes);
  decrypted += cipher.final();

  return decrypted;
};

// This HTTPS endpoint can only be accessed by your Firebase Users.
// Requests need to be authorized by providing an `Authorization` HTTP header
// with value `Bearer <Firebase ID Token>`.
exports.app = functions.runWith({
  timeoutSeconds: 120,
  memory: '1GB',
}).region('asia-east1').https.onRequest(app);
