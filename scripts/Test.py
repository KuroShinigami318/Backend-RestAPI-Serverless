import requests
import json
import subprocess
import datetime
import os
import threading
from Crypto.Cipher import AES

backend_url = "http://127.0.0.1:5001/backend-restapi-5ee97/asia-east1/app"
api_key = 'AIzaSyBDPRtq6-RLD713Im-BXwj4Fnz0O0A_Pkw'

def GetAuth(filePath):
    data = ReadFromJSON(filePath)
    now = datetime.datetime.now()
    if (not data):
        url = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + api_key
        header = {"Content-Type": "application/json"}
        body = {
           "returnSecureToken": "true"
        }
        body = json.dumps(body)
        r = requests.post(url=url, headers=header, data=body)
        result = json.loads(r.text)
        if('error' in result):
           print('response with error: %s\nMessage: %s'%(result['error']['status'], result['error']['message']))
           return False
        WriteToJSON(filePath, json.dumps(result))
        UpdateExpireDate(filePath=filePath, updateTime=now)
        return True
    
    if ('expiresAt' not in data or datetime.datetime.fromisoformat(data['expiresAt']) < now):  
        url = 'https://securetoken.googleapis.com/v1/token?key=' + api_key
        header = {"Content-Type": "application/json"}
        body = {
        "grant_type": "refresh_token",
        "refresh_token": data['refreshToken']
        }
        body = json.dumps(body)
        r = requests.post(url=url, headers=header, data=body)
        result = json.loads(r.text)
        if('error' in result):
           print('response with error: %s\nMessage: %s'%(result['error']['status'], result['error']['message']))
           return False
        data['idToken'] = result['id_token']
        data['refreshToken'] = result ['refresh_token']
        data['expiresIn'] = result['expires_in']
        UpdateExpireDate(data=data, updateTime=now)
    return True

def UpdateExpireDate(updateTime, filePath = None, data = None):
    if (not filePath is None):
        data = ReadFromJSON(filePath)
    deltaTime = datetime.timedelta(seconds=float(data['expiresIn']))
    data['expiresAt'] = datetime.datetime.isoformat(updateTime + deltaTime)
    jsonData = json.dumps(data)
    WriteToJSON('auth.json', jsonData)

def Encrypt(message):
   key = bytes(bytearray([71, 196, 224, 77, 66, 145, 169, 76, 2, 133, 239, 154, 57, 226, 248, 133]))
   nonce = bytes(bytearray([215, 6, 250, 248, 50, 225, 252, 129, 78, 248, 178, 28, 93, 245, 154, 246]))
   cipher = AES.new(key, AES.MODE_CTR, nonce=nonce)
   print(list(cipher.nonce))
   ciphertext = cipher.encrypt(bytes(message.encode('utf-8')))
   print(list(ciphertext))
   return list(ciphertext)

def Login(url, idToken, idUser, pwd):
    startTime = datetime.datetime.now()
    header = {"Authorization": "Bearer " + idToken,
              "Content-Type": "application/json"}
    data = {"id": idUser, "pass": pwd}
    data = json.dumps(data)
    r = requests.post(url=url, headers=header, data=data)
    finishTime = datetime.datetime.now()
    elapsed = finishTime - startTime
    print(r.text)
    print('Execution finished with %ds'%(elapsed.seconds))

def ReadFromJSON(filePath):
    if (not os.path.isfile(filePath)):
       return False
    f = open(filePath)
    data = json.load(f)
    return data

def WriteToJSON(filePath, data):
    if (not IsJSON(data)):
       print("data is not in json format")
       return
    f = open(filePath, 'w')
    f.write(data)

def IsJSON(jsonData):
  try:
    json.loads(jsonData)
  except ValueError as e:
    return False
  return True

curDir = os.getcwd()
if (GetAuth(curDir + '/auth.json')):
    data = ReadFromJSON(curDir + '/auth.json')
    t1 = threading.Thread(target=Login, args=(backend_url + "/login", data['idToken'], "3118412027", [57, 170, 240, 170, 214, 153, 108, 250]))
    t2 = threading.Thread(target=Login, args=(backend_url + "/all", data['idToken'], "3118412027", [57, 170, 240, 170, 214, 153, 108, 250]))

    # starting thread 1
    t1.start()
    # starting thread 2
    t2.start()
 
    # wait until thread 1 is completely executed
    t1.join()
    # wait until thread 2 is completely executed
    t2.join()