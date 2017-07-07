'use strict';

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { argv } = require('yargs');
const { exec } = require('child_process');
const readFile = require('./readFileT.js');
const accessKeyId = null;
const secretAccessKey = null;
const region = null;

const config = {
  /*id: null,
  customerId: null,
  bucket: null,
  aws: {
    accessKeyId: null,
    secretAccessKey: null,
    region: null
  }*/
};

try {
  Object.assign(config, JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.sfcwrc'), 'UTF-8')));
} catch(ignore) {
  console.log(`Can't find config file at ${path.join(process.env.HOME, '.sfcwrc')}`);
}

if(argv.customerId) config.customerId = argv.customerId;
if(argv.id) config.id = argv.id;
if(argv.bucket) config.bucket = argv.bucket;

const promises = [
  new Promise((resolve, reject) => {
    readFile('/proc/net/dev', 'UTF-8', (err, data) => {
      if(err) return reject(err);
      resolve(data);
    });
  }),
  new Promise((resolve, reject) => {
    readFile('/proc/meminfo', 'UTF-8', (err, data) => {
      if(err) return reject(err);
      resolve(data);
    });
  }),
  new Promise((resolve, reject) => {
    readFile('/proc/stat', 'UTF-8', (err, data) => {
      if(err) return reject(err);
      resolve(data);
    });
  }),
  new Promise((resolve, reject) => {
    exec('/bin/df -k -l -P', (err, out, code) => {
      if(err) return reject(err);
      resolve(out, code);
    });
  }),
  new Promise((resolve, reject) => {
    readFile('/proc/cpuinfo', 'UTF-8', (err, data) => {
      if(err) return reject(err);
      resolve(data);
    });
  })
];

Promise.all(promises).then(values => {
  const ram = values[1].data.replace(/ /g, '').split(/\r|\n/);
  const cpu = values[2].data.split(/\r|\n/);
  const disk = values[3].split(/\r|\n/);
  const time = Date.now().valueOf();
  const cpuInfo = values[4].data;
  const net = values[0].data.split(/\r|\n/);

  const cpuResult = {
    time: values[2].time,
    total: null,
    cpus: []
  };

  const cores = cpuInfo.length - 1;
  cpuResult.info = {
    cores,
    speed: []
  };

  cpuResult.info.speed = _findValue(cpuInfo, 'cpu MHz', ':');
  cpuResult.info.cores = cpuResult.info.speed.length;

  cpu.some((line, index) => {
    if(!line.startsWith('cpu')) return true;
    const [cpuName, user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice] = line.replace(/\s+/, ' ').split(/ /g);
    const result = { cpuName, user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice };

    if(index === 0) {
      cpuResult.total = result;
    } else {
      cpuResult.cpus.push(result);
    }
  });

  const diskResult = [];

  disk.forEach((line, index) => {
    if (index === 0) return;
    line = line.split(/\s+/);
    if(line.length < 6) return;

    diskResult.push({
      name: line[0],
      mountPoint: line[5],
      capacity: line[4],
      used: line[2],
      available: line[3]
    });

  });

  const netResult = [];

  net.forEach((line, index) => {
    if(index < 2) return;
    const split = line.split(/\s+/);
    if(split.length < 11) return;
    netResult.push({
      name: split[0].substring(0, split[0].length-1),
      bytes_in: split[1],
      packets_in: split[2],
      bytes_out: split[9],
      packets_out: split[10]
    });
  });

  const out = {
    id: argv.id || config.id, //todo aggiungi caricato da file di ubuntu,
    cpu: cpuResult,
    memory: {
      time: values[1].time,
      MemTotal: ram[0].substring(9, ram[0].length-2),
      MemFree: ram[1].substring(8, ram[1].length-2),
      MemAvailable: ram[2].substring(13, ram[2].length-2)
    },
    disk: diskResult,
    network: netResult
  };

  const s3 = _initializeS3(config, argv);
  s3.upload({
    Bucket: config.bucket,
    Key: `${config.customerId}/${out.id}/${config.customerId}_${out.id}_${time}`,
    ContentType: 'application/json',
    Body: JSON.stringify(out)
  }, (err, result) => {
    if(err) return console.log(err);
    console.log(result);
  });
});


function _initializeS3(config, argv) {
  if(config.aws) {
    return new AWS.S3(config.aws);
  } else if(accessKeyId) {
    return new AWS.S3({
      accessKeyId,
      secretAccessKey,
      region
    });
  } else {
    return new AWS.S3();
  }
}


function _findValue(text, key, separator, reg = new RegExp(key), results = []) {
  let startIndex = text.search(reg);
  if(startIndex === -1) return results;
  startIndex += key.length;
  let index = startIndex;

  while(text.length > index && text[index] !== '\n') {
    if(text[index] === separator){
      startIndex = index + 1;
    }
    index++;
  }

  results.push(text.substring(startIndex, index).trim());

  return _findValue(text.substring(index + 1), key, separator, reg, results);
}
