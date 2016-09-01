"use strict";
var config          = require('./config/config.js');
var winston         = require('winston');
var schedule        = require('node-schedule');
var async           = require('async');
var spawn           = require('child_process').spawn;
var fs              = require('fs');
var chokidar        = require('chokidar');
var path            = require('path');
var crypto          = require('crypto');
var nodemailer      = require('nodemailer');
var Slack           = require('slack-node');
var anymatch        = require('anymatch');

// UTILS
function replaceWith(text, objParams){

  var currentTime = new Date();
  objParams.DD = currentTime.getDay();
  objParams.MM = currentTime.getMonth();
  objParams.YY = currentTime.getYear();
  objParams.YYYY = currentTime.getFullYear();
  objParams.HH = currentTime.getHours();
  objParams.mm = currentTime.getMinutes();
  objParams.ss = currentTime.getSeconds();

  var keys = Object.keys(objParams);

  function orderByLength(a, b) {
    if (a.length > b.length) {
      return 1;
    }
    if (a.length < b.length) {
      return -1;
    }
    return 0;
  }

  keys.sort(orderByLength);
  var keysLength = keys.length;

  while (keysLength--) {
    text = text.replace(new RegExp('\\:' + keys[keysLength], 'g'), objParams[keys[keysLength]] || '');
  }
  return text;
}

function readFilePromise(type, file){
  return new Promise(function(resolve, reject) {
    fs.readFile(file, function(err, data){
      var res = {};
      if(err){
        res[type] = err;
        reject(res);
      }else{
        res[type] = data;
        resolve(res);
      }
    });
  });
}

function sendMail(mail, callback){

  var transport = nodemailer.createTransport(mail.transport);
  var filesReads = [];

  var templateDir  = path.resolve(mail.templateDir, mail.template);
  var htmlTemplate = path.resolve(templateDir, 'html.html');
  var txtTemplate	 = path.resolve(templateDir, 'text.txt');

  filesReads.push(readFilePromise('html',htmlTemplate));
  filesReads.push(readFilePromise('text', txtTemplate));

  Promise.all(filesReads)
    .then(function (res) {

      var html_data;
      var text_data;

      if(res[0].hasOwnProperty('html')){
        html_data = res[0].html.toString();
        text_data = res[1].text.toString();
      }else{
        html_data = res[1].html.toString();
        text_data = res[0].text.toString();
      }

      var html = replaceWith(html_data, mail.params);
      var text = replaceWith(text_data, mail.params);

      var mailOptions = {
        from: mail.from,
        to: mail.to,
        subject: mail.params.subject,
        text: text,
        html: html
      };

      if(mail.disable){
        logger.log('warn','Mail sender is disable.');
        callback();
      }else{
        transport.sendMail(mailOptions,
          function(err, res){
            if(err) {
              logger.log('error','Error sending mail:',err);
              callback(err,null);
            }else{
              callback(null,res);
            }
          });
      }
    })
    .catch(function(e){
      logger.log('error','Error sending mail:',e);
      callback(e,null);
    });
};

// LOGGER  ---------------------------------------------------------------------
var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({colorize: 'all', level: 'debug'}),
   // new (winston.transports.File)({name: 'info-file', filename: 'filelog-info.log', level: 'info'}),
   // new (winston.transports.File)({name: 'error-file',filename: 'filelog-error.log',level: 'error'}),
  ]
});

// CLASSES ---------------------------------------------------------------------

class Notification {
  constructor(type, id, title, message, recipients, recipients_cc, recipients_cco) {
    this.type = type;
    this.id = id;
    this.title = title;
    this.message = message;
    this.recipients = recipients;
    this.recipients_cc = recipients_cc;
    this.recipients_cco = recipients_cco;
  }

  notificate(){
    logger.log('warn','Este método debería de haber sido reescrito en la clase child');
  }

  loadConfig(){
    var _this = this;
    return new Promise((resolve) => {

        var filePath = config.configFilePath;

        if(_this.id){
          fs.stat(filePath, function(err, res){
          if(err){
            logger.log('error',`Conf file ${filePath} not exists.`, err);
            throw new Error(`Conf file ${filePath} not found.`);
            resolve();
          }else {
            try {
              fs.readFile(filePath, 'utf8', function (err, res) {
                if (err) {
                  logger.log('error', 'Conf loadConfig readFile: ' + err);
                  resolve();
                } else {
                  var objConf = JSON.parse(res).config;

                  if (objConf.hasOwnProperty('notificators_connections')) {
                    var notificationsConnLength = objConf.notificators_connections.length;
                    var config;
                    while (notificationsConnLength--) {
                      if (objConf.notificators_connections[notificationsConnLength].id === _this.id) {
                        notificationsConnLength = 0;
                        config = objConf.notificators_connections[notificationsConnLength];
                      }
                    }

                    if (config) {
                      resolve(config);
                    } else {
                      throw new Error(`Config for ${_this.id} not found`);
                      resolve();
                    }

                  } else {
                    throw new Error('Invalid Config file, notificators_connections not found.', objConf);
                    resolve();
                  }

                }
              });
            } catch (e) {
              throw new Error('Invalid Config file, incorrect JSON format: ' + e.message, e);
              resolve();
            }
          }
          });
        }else{
            resolve();
          }
  });
  }

}

class mailNotificator extends Notification{
  constructor(type, id, title, message, recipients, recipients_cc, recipients_cco){
    super('mail', id, title, message, recipients, recipients_cc, recipients_cco);
    return new Promise((resolve) => {
      resolve(this);
    });
  }

notificate(values){

    return new Promise((resolve) => {
      var mailOptions = {};
      mailOptions.params = values;
      mailOptions.from = config.mailOptions.from;
      mailOptions.transport = config.mailOptions.transport;
      mailOptions.templateDir = config.mailOptions.templateDir;
      mailOptions.default_template = config.mailOptions.default_template;
      mailOptions.template = config.mailOptions.default_template;
      mailOptions.disable = config.mailOptions.disable;

      for (var i = 0, len = this.recipients.length; i < len; i++) {
        if (i){
          mailOptions.to = mailOptions.to + this.recipients[i] + ((i < len-1) ? ', ' : '');
        }
        else{
          mailOptions.to = this.recipients[i] + ((i < len-1) ? ', ' : '');
        }
      }

      for (var i = 0, len = this.recipients_cc.length; i < len; i++) {
        if (i){
          mailOptions.cc = mailOptions.cc + this.recipients_cc[i] + ((i < len-1) ? ', ' : '');
        }
        else{
          mailOptions.cc = this.recipients_cc[i] + ((i < len-1) ? ', ' : '');
        }
      }

      for (var i = 0, len = this.recipients_cco.length; i < len; i++) {
        if (i){
          mailOptions.bcc = mailOptions.bcc + this.recipients_cco[i] + ((i < len-1) ? ', ' : '');
        }
        else{
          mailOptions.bcc = this.recipients_cco[i] + ((i < len-1) ? ', ' : '');
        }
      }

      mailOptions.params.subject = replaceWith(this.title, values);
      mailOptions.params.message = replaceWith(this.message, values);

      sendMail(mailOptions, function(err, res){
        if (err){
          logger.log('error','Error sending mail:'+e,mailOptions,values);
        }
        resolve(res);
      });
    });
  }
}

class slackNotificator extends Notification{
  constructor(type, id, token, bot_name, bot_emoji, message, channel, recipients){
    super('slack', id, null, message, recipients, null, null);

    this.token = token;
    this.bot_name = bot_name;
    this.bot_emoji = bot_emoji;
    this.channel = channel;

    return new Promise((resolve) => {
      resolve(this);
    });
  }

  notificate(values){
    return new Promise((resolve) => {

        this.loadConfig()
        .then((config) => {
            if (config){
              if (!this.token && config.token) this.token = config.token;
              if (!this.bot_name && config.bot_name) this.bot_name = config.bot_name;
              if (!this.bot_emoji && config.bot_emoji) this.bot_emoji = config.bot_emoji;
              if (!this.channel && config.channel) this.channel = config.channel;
            }



            var slack = new Slack(this.token);
            var msg = replaceWith(this.message, values);

            slack.api('chat.postMessage', {
              text: msg,
              channel: this.channel,
              username: this.bot_name,
              icon_emoji: this.bot_emoji,
            },function(err, response){
              if(err){
                logger.log('error','Slack notification: '+err);
                logger.log('error','Slack notification: '+msg);
              }
            });
            resolve();
         })
        .catch(function(e){
            logger.log('error','Slack notificate loadConfig '+e)
            resolve();
          });
      });
  }
}

class Event {
  constructor(name, process, notifications){
    return new Promise((resolve) => {
      this.loadEventsObjects(name, process, notifications)
        .then((events) => {
          resolve(events);
        })
        .catch(function(e){
           logger.log('error','Event constructor '+e);
           resolve();
         });
    });
  }

  loadEventsObjects(name, process, notifications) {
    return new Promise((resolve) => {
      var objEvent = {};
      objEvent[name] = {};

      //TODO: event/proccess

      var notificationsPromises = [];

      if (notifications instanceof Array) {
        var notificationsLength = notifications.length;
        if (notificationsLength > 0) {

          while (notificationsLength--) {
            var notification = notifications[notificationsLength];
            switch (notification.type) {
              case 'mail':
                notificationsPromises.push(new mailNotificator(notification.type,
                                                               notification.id,
                                                               notification.title,
                                                               notification.message,
                                                               notification.recipients,
                                                               notification.recipients_cc,
                                                               notification.recipients_cco
                                                               ));
                break;
              case 'slack':
                notificationsPromises.push(new slackNotificator(notification.type,
                                                                notification.id,
                                                                notification.token,
                                                                notification.bot_name,
                                                                notification.bot_emoji,
                                                                notification.message,
                                                                notification.channel,
                                                                notification.recipients
                                                                ));
                break;
            }
          }

          Promise.all(notificationsPromises)
            .then(function (res) {
              objEvent[name]['notifications'] = res;
              resolve(objEvent);
            })
            .catch(function(e){
              logger.log('error','Event loadEventsObjects: '+e);
              resolve(objEvent);
            });

        } else {
          logger.log('error','Event loadEventsObjects: '+e);
          resolve(objEvent);
        }
      } else {
        logger.log('error','Notifications, is not array', name, process, notifications);
        resolve(objEvent);
      }
    });
  }
}

class Process {
  constructor(id, name, depends_process, depends_process_alt, command, args, retries, retry_delay, limited_time_end, events, status, execute_return, execute_err_return, started_at, ended_at, chain_values){
    this.id = id;
    this.name = name;
    this.depends_process = depends_process;
    this.depends_process_alt = depends_process_alt;
    this.command = command;
    this.args = args;
    this.retries = retries;
    this.retry_delay = retry_delay;
    this.limited_time_end = limited_time_end;
    this.status = status || "stop";
    this.execute_return = execute_return;
    this.execute_err_return = execute_err_return;
    this.started_at = started_at;
    this.ended_at = ended_at;
    this.events;

    this.chain_values = chain_values;

    return new Promise((resolve) => {
      this.loadEvents(events)
        .then((events) => {
          this.events = events;
          resolve(this);
          })
        .catch(function(e){
          logger.log('error','Process constructor loadEvents:'+e);
          resolve(this);
        });
    });

  }

  values(){
    var _this = this;
    return {
      "CHAIN_ID":_this.chain_values.CHAIN_ID,
      "CHAIN_NAME":_this.chain_values.CHAIN_NAME,
      "CHAIN_STARTED_AT":_this.chain_values.CHAIN_STARTED_AT,
      "PROCESS_ID":_this.id,
      "PROCESS_NAME":_this.name,
      "PROCESS_COMMAND":_this.command,
      "PROCESS_ARGS":_this.args,
      "PROCESS_EXECURTE_ARGS":_this.execute_args,
      "PROCESS_EXECUTE_RETURN":_this.execute_return,
      "PROCESS_EXECUTE_ERR_RETURN":_this.execute_err_return,
      "PROCESS_STARTED_AT":_this.started_at,
      "PROCESS_ENDED_AT":_this.ended_at,
      "PROCESS_RETRIES_COUNT": _this.retries_count,
      "PROCESS_RETRIES": _this.retries,
      "PROCESS_DEPENDS_FILES_READY": _this.depends_files_ready,
      "PROCESS_FIRST_DEPEND_FILE_READY": (_this.depends_files_ready && _this.depends_files_ready.length > 0) ? _this.depends_files_ready[0] : [],
      "PROCESS_LAST_DEPEND_FILE_READY": (_this.depends_files_ready && _this.depends_files_ready.length > 0) ? _this.depends_files_ready[_this.depends_files_ready.length - 1] : []
    };
  }

  loadEvents(events){
    return new Promise((resolve) => {
      var processEventsPromises = [];

      if (events instanceof Object) {
        var keys = Object.keys(events);
        var keysLength = keys.length;
        if (keys instanceof Array) {
          if (keysLength > 0) {
            while (keysLength--) {
              var event = events[keys[keysLength]];
              if(event.hasOwnProperty('process') || event.hasOwnProperty('notifications')){
                processEventsPromises.push(new Event(keys[keysLength],
                                                     event.process,
                                                     event.notifications
                                                     ));
              }else{
                logger.log('debug','Process Events without procces and notifications');
              }
            }

            Promise.all(processEventsPromises)
              .then(function (eventsArr) {
                var events = {};
                var eventsArrLength = eventsArr.length;
                while (eventsArrLength--) {
                  var e = eventsArr[eventsArrLength];
                  var key = Object.keys(e);
                  events[key[0]] = e[key[0]];
                }
                resolve(events);
              })
              .catch(function(e){
                logger.log('error','Process loadEvents: '+e);
                resolve();
              });
          }
        }
      }else{
        logger.log('error','Process, events is not object', err);
        resolve();
      }
    });
  }

  notificate(event){
    var _this = this;

    if(_this.hasOwnProperty('events') && _this.events !== undefined){
      if(_this.events.hasOwnProperty(event)){
        if(_this.events[event].hasOwnProperty('notifications')){
          if(_this.events[event].notifications instanceof Array){

            var notificationsLength = _this.events[event].notifications.length;
            while(notificationsLength--){
              _this.events[event].notifications[notificationsLength].notificate(_this.values())
                .then(function(res){
                  logger.log('debug','Notification process sended: '+res)
                })
                .catch(function(e){
                  logger.log('error',`Notificating ${event} process ${_this.id}:`+e)
                })
            }
          }
        }
      }
    }
  }

  isStoped(){
    return (this.status === 'stop');
  }

  isEnded(){
    return (this.status === 'end');
  }

  isRunning(){
    return (this.status === 'running');
  }

  isErrored(){
    return (this.status === 'error');
  }

  stop(){
    var _this = this;
    _this.status = 'stop';
    _this.ended_at = new Date();
  }

  end(noRunned){

    noRunned = noRunned || false; // If process has not been executed but we need set to end

    var _this = this;
    _this.status = 'end';
    _this.ended_at = new Date();

    //Clear depends_files_ready for re-check:
    _this.depends_files_ready = [];

    if(!noRunned){
      _this.notificate('on_end');
    }
  }

  error(){
    var _this = this;
    _this.status = 'error';
    _this.notificate('on_fail');
  }

  start(isRetry, forceOnceInRetry){
    var _this = this;
    _this.status = 'running';
    _this.started_at = new Date();

    if(!isRetry || isRetry === undefined){
      _this.notificate('on_start');
    }

    // forceOnceInRetry: this indicates that only try once in retry
    if(!forceOnceInRetry || forceOnceInRetry === undefined){
      forceOnceInRetry = false;
    }

    return new Promise(function(resolve, reject) {
      var stdout = '';
      var stderr = '';

      function repArg(arg){
        return replaceWith(arg, _this.values());
      }
      _this.execute_args = _this.args.map(repArg);

      _this.proc = spawn(_this.command, _this.execute_args);

      _this.proc.stdout.on('data', function(chunk) {
        stdout += chunk;
      });
      _this.proc.stderr.on('data', function(chunk) {
        stderr += chunk;
      });
      _this.proc.on('error', reject)
        .on('close', function(code) {
          if (code === 0) {
            _this.execute_return = stdout;
            _this.execute_err_return = stderr;
            _this.end();
            resolve(stdout);
          } else {
            logger.log('error',_this.id+'FIN: '+code+' - '+stdout+' - '+stderr);

            _this.execute_return = stdout;
            _this.execute_err_return = stderr;
            _this.retries_count = _this.retries_count +1 || 1;
            _this.error();

            if(_this.retries >= _this.retries_count && !forceOnceInRetry){

              _this.retry();

              setTimeout(function(){
                _this.start(true)
                  .then(function(res) {
                    _this.retries_count = 0;
                    resolve(res);
                  })
                  .catch(function(e){
                    logger.log('error','Retrying process:'+e)
                    resolve(e);
                  });
              }, _this.retry_delay * 1000 || 0);

            }else{
              reject(stderr);
            }
          }
        });
    });
  }

  retry(){
    var _this = this;
    _this.notificate('on_retry');
  }

  waiting_dependencies(){
    var _this = this;
    _this.notificate('on_waiting_dependencies');
  }
}

class Chain {
  constructor(id, name, start_date, end_date, schedule_interval, prevent_overlap, depends_chains, depends_chains_alt, events, processes, status, started_at, ended_at) {
    this.id = id;
    this.name = name;
    this.start_date = start_date;
    this.end_date = end_date;
    this.schedule_interval = schedule_interval;
    this.prevent_overlap = prevent_overlap;
    this.depends_chains = depends_chains;
    this.depends_chains_alt = depends_chains_alt;
    this.events;
    this.status = status || "stop";
    this.started_at = started_at;
    this.ended_at = ended_at;
    this.processes;

    return new Promise((resolve) => {
      var _this = this;

      _this.loadProcesses(processes)
        .then((processes) => {
        _this.processes = processes;

        _this.loadEvents(events)
            .then((events) => {
            _this.events = events;
            resolve(_this);
            })
            .catch(function(e){
                logger.log('error','Chain loadEvents: '+e);
                resolve();
              });
        })
        .catch(function(e){
          logger.log('error','Chain loadProcesses: '+e);
          resolve();
        });
    });
  }

  // Executed in construction:
  loadProcesses(processes){
    var _this = this;
    return new Promise((resolve) => {
      var chainProcessPromises = [];
      var processesLength = processes.length;
      if (processes instanceof Array) {
        if (processesLength > 0) {

          while(processesLength--){
            var process = processes[processesLength];
/*
            var objProcess = new Process(process.id,
                                         process.name,
                                         process.depends_process,
                                         process.depends_process_alt,
                                         process.command,
                                         process.args,
                                         process.retries,
                                         process.retry_delay,
                                         process.limited_time_end,
                                         process.events,
                                         process.status,
                                         process.execute_return,
                                         process.execute_err_return,
                                         process.started_at,
                                         process.ended_at,
                                         _this.values());
*/
            chainProcessPromises.push(_this.loadProcess(process));
          }

          Promise.all(chainProcessPromises)
            .then(function(processes) {
              var processesLength = processes.length;
              while(processesLength--){
                _this.loadProcessFileDependencies(processes[processesLength]);
              }
              resolve(processes);
            })
            .catch(function(e){
              logger.log('error','Chain loadProcesses:'+e)
              resolve();
            });

        }else{
          resolve();
        }
      }else{
        logger.log('error','Chain, processes is not array', err);
        resolve();
      }
    });
  }

  loadProcess(process){
    var _this = this;
    return new Promise((resolve) => {
        new Process(process.id,
          process.name,
          process.depends_process,
          process.depends_process_alt,
          process.command,
          process.args,
          process.retries,
          process.retry_delay,
          process.limited_time_end,
          process.events,
          process.status,
          process.execute_return,
          process.execute_err_return,
          process.started_at,
          process.ended_at,
          _this.values())
          .then(function(res) {
            resolve(res);
          })
          .catch(function(e){
            logger.log('error','Loading process:'+e);
            resolve();
          });
      });
  }

  loadEvents(events){
    return new Promise((resolve) => {
    var processEventsPromises = [];

    if (events instanceof Object) {
      var keys = Object.keys(events);
      var keysLength = keys.length;
        if (keysLength > 0) {
          while (keysLength--) {
            var event = events[keys[keysLength]];
            if(event.hasOwnProperty('process') || event.hasOwnProperty('notifications')){
              processEventsPromises.push(new Event(keys[keysLength],
                event.process,
                event.notifications
              ));
            }else{
              logger.log('debug','Chain Events without procces and notifications');
            }
          }

          Promise.all(processEventsPromises)
            .then(function (eventsArr) {
              var events = {};
              var eventsArrLength = eventsArr.length;
              while (eventsArrLength--) {
                var e = eventsArr[eventsArrLength];
                var key = Object.keys(e);
                events[key[0]] = e[key[0]];
              }
              resolve(events);
            })
            .catch(function(e){
              logger.log('error','Chain events: '+e);
              resolve();
            });

        }else{
          logger.log('warn','Chain, events is empty');
          resolve();
        }
    }else{
      logger.log('warn','Chain, events is not object');
      resolve();
    }
  });
  }

  loadProcessFileDependencies(process){
      var _this = this;

      var depends_process = process.depends_process;
      var dependsProcessLength = depends_process.length;

      if (dependsProcessLength > 0) {
        while (dependsProcessLength--) {
          var dependence = depends_process[dependsProcessLength];

          if(dependence instanceof Object){
            if(dependence.hasOwnProperty('file_name') && dependence.hasOwnProperty('condition')){

              //TODO: VALIDATE CONDITIONS VALUES

              var watcher = chokidar.watch(dependence.file_name, { ignored: /[\/\\](\.|\~)/,
                persistent: true,
                usePolling: true,
                awaitWriteFinish: {
                  stabilityThreshold: 2000,
                  pollInterval: 150
                }
              });

              watcher.on(dependence.condition, function(pathfile) {
                if(process.depends_files_ready){
                  process.depends_files_ready.push(pathfile);
                }else{
                  process.depends_files_ready = [pathfile];
                }

                // If chain is running try execute processes:
                if(_this.isRunning()){
                  _this.startProcesses();
                }
              })

              if(process.file_watchers){
                process.file_watchers.push(watcher);
              }else{
                process.file_watchers = [watcher];
              }

            }
          }
        }
      }
  }

  getProcessById(processId){
    var _this = this;

    function byId(process){
      return process.id === processId;
    }

    return _this.processes.find(byId);
  }

  values(){
    var _this = this;
    return {
      "CHAIN_ID":_this.id,
      "CHAIN_NAME":_this.name,
      "CHAIN_STARTED_AT":_this.started_at
    };
  }

  notificate(event){
    var _this = this;
    if(_this.hasOwnProperty('events') && _this.events !== undefined){
      if(_this.events.hasOwnProperty(event)){
        if(_this.events[event].hasOwnProperty('notifications')){
          if(_this.events[event].notifications instanceof Array){
            var notificationsLength = _this.events[event].notifications.length;
            while(notificationsLength--){
              _this.events[event].notifications[notificationsLength].notificate(_this.values())
                .then(function(res){
                  logger.log('debug','Notification chain sended: '+res)
                })
                .catch(function(e){
                  logger.log('error','Notification chain sended: '+e)
                });
            }
          }
        }
      }
    }
  }

  isStoped(){
    return (this.status === 'stop');
  }

  isEnded(){
    return (this.status === 'end');
  }

  isRunning(){
    return (this.status === 'running');
  }

  isErrored(){
    return (this.status === 'error');
  }

  stop(){
    this.status = 'stop';
  }

  end(){
    this.ended_at = new Date();
    this.status = 'end';
    this.notificate('on_end');
  }

  running(){
    this.started_at = new Date();
    this.notificate('on_start');
  }

  error(){
    this.status = 'error';
    this.notificate('on_fail');
  }

  //Start Chain
  start(){
    var chain = this;

    return new Promise((resolve) => {

      if(chain.hasOwnProperty('processes')){
        if(chain.processes instanceof Array && chain.processes.length > 0){
          // Initialize Chain
          if(chain.schedule_interval){

            chain.scheduleRepeater = schedule.scheduleJob(chain.schedule_interval, function(chain){

              if((new Date(chain.end_date)) < (new Date())){
                chain.scheduleRepeater.cancel();
              }

              if(chain.isStoped() || chain.isEnded()){
                chain.setChainToInitState()
                  .then(function(){
                    chain.startProcesses()
                      .then(function(res){
                        resolve();
                      })
                      .catch(function(e){
                        logger.log('error','Error in startProcesses:'+e);
                        resolve();
                      });
                  })
                  .catch(function(e){
                    logger.log('error','Error setChainToInitState: '+e);
                    resolve();
                  })
              }else{
                logger.log('warn',`Trying start processes of ${chain.id} but this is running`);
              }
            }.bind(null,chain))

          }else{
            chain.startProcesses()
              .then(function(res){
                resolve();
              })
              .catch(function(e){
                logger.log('error','Error in startProcesses:'+e);
                resolve();
              });
          }
        }else{
          logger.log('error',`Chain ${chain.id} dont have processes`);
          throw new Error(`Chain ${chain.id} dont have processes`);
          resolve();
        }
      }else{
        logger.log('error',`Invalid chain ${chain.id}, processes property not found.`);
        throw new Error(`Invalid chain ${chain.id}, processes property not found.`);
        resolve();
      }
      });
  }

  waiting_dependencies(){
    var _this = this;
    _this.notificate('on_waiting_dependencies');
  }

  setChainToInitState(){
    return new Promise((resolve) => {
      //Warning
      if (this.isRunning()){
        logger.log('warn',`This chain ${this.id} is running yet and is being initialized`)
      }
      // Set All Process to stopped
      var processesLength = this.processes.length;
      while(processesLength--) {
        this.processes[processesLength].stop();
      }
      resolve();
    });
  }

  refreshChainStatus(){
    return new Promise((resolve) => {

      var processesLength = this.processes.length;
      var statusChain = 'end';

      var processesError   = 0;
      var processesEnd     = 0;
      var processesRunning = 0;
      var processesStop    = 0;

      while(processesLength--) {
        switch (this.processes[processesLength].status)
        {
         case 'stop'   : processesStop += 1;    break;
         case 'end'    : processesEnd += 1;     break;
         case 'running': processesRunning += 1; break;
         case 'error'  : processesError += 1;   break;
        }
      }
      //Set Chain Status
      if (processesRunning > 0 || processesStop > 0){
        statusChain = 'running';
      }else{
        if (processesError > 0){
          statusChain = 'error';
        }else{
          statusChain = 'end';
        }
      }

      this.status = statusChain;
      resolve(statusChain);
    });
  }

  startProcesses(){

    var _this = this;

    var runningBeforeRefresh = _this.isRunning();

    return new Promise(function(resolve, reject) {
      _this.refreshChainStatus()
        .then(function(chainStatus){

          if(chainStatus === 'running' && !runningBeforeRefresh){
            _this.running();
          }

          // If Chains is running:
          if (chainStatus === 'running'){
            var chainProcessesLength = _this.processes.length;

            while(chainProcessesLength--) {
              var process = _this.processes[chainProcessesLength];

              if (process.isStoped() || process.isErrored()){
                logger.log('debug', `PLANIFICADO PROCESO ${process.id}`);

  /*
                if(_this.hasProcessDependecies(process).length > 0){
                  logger.log('debug', `Ejecutar PROCESO ${process.id} -> on_waiting_dependencies: `,_this.hasProcessDependecies(process));
                  _this.waiting_dependencies();
                }else{
                  logger.log('debug', `Ejecutar YA ${process.id} -> start`);

                  process.start()
                    .then(function(){
                      _this.startProcesses()
                        .then(function(res){
                          resolve();
                        })
                        .catch(function(e){
                          logger.log('error','Error in startProcesses:'+e);
                          resolve();
                        })
                    })
                    .catch(function(e){
                      logger.log('error','Error in process.start:'+e);
                      resolve();
                    })
                }
*/

                var processMustDo = _this.checkProcessActionToDo(process);

                switch(processMustDo){
                  case 'run':

                    logger.log('debug', `Ejecutar YA ${process.id} -> start`);

                    process.start()
                      .then(function(){
                        _this.startProcesses()
                          .then(function(res){
                            resolve();
                          })
                          .catch(function(e){
                            logger.log('error','Error in startProcesses:'+e);
                            resolve();
                          })
                      })
                      .catch(function(e){
                        logger.log('error','Error in process.start:'+e);

                        // Aun cuando hay error puede que haya procesos que tengan que ejecutarse:
                        _this.startProcesses()
                          .then(function(res){
                            resolve();
                          })
                          .catch(function(e){
                            logger.log('error','Error in startProcesses:'+e);
                            resolve();
                          })


                        resolve();
                      })

                    break;
                  case 'wait':

                    logger.log('debug', `Ejecutar PROCESO ${process.id} -> on_waiting_dependencies `);
                    _this.waiting_dependencies();

                    break;
                  case 'end':
                    logger.log('debug', `No se ejecuta el PROCESO ${process.id} -> solo on_fail `);
                    _this.end(true);
                    break;
                }


              }
            }
          }else{
            resolve();
          }
        })
        .catch(function(e){
          logger.log('error','Error en refreshChainStatus: '+e);
          resolve();
        })
    });
  }


  checkProcessActionToDo(process){

    var _this = this;
    var action = 'run';

    if(process.hasOwnProperty('depends_process') && process.depends_process.length > 0){
      var depends_process = process.depends_process;
      var planProcess = this.processes;

      var dependsprocessLength = depends_process.length;

      //File dependences:
      // Check process dependencies
      while(dependsprocessLength--) {
        if (typeof depends_process[dependsprocessLength]) {
          if(depends_process[dependsprocessLength].hasOwnProperty('file_name')){
            // If any depends files is ready
            if(process.depends_files_ready){

              // Check if all process depends files is ready
              var depends_files_ready_length = process.depends_files_ready.length;
              var dependenceFound = false;

              while(depends_files_ready_length--){
                // Using anumatch to check regular expression glob:
                if (anymatch([depends_process[dependsprocessLength].file_name], process.depends_files_ready[depends_files_ready_length])){
                  dependenceFound = true;
                }
              }

              if (!dependenceFound){
                action = 'wait';
              }

            }else{
              action = 'run';
            }
          }
        }
      }

      //Process dependences:
      var planProcessLength = this.processes.length;
      dependsprocessLength = depends_process.length;

      while(planProcessLength--){
        var auxDependsprocessLength = dependsprocessLength;

        while(auxDependsprocessLength--){
          switch (typeof depends_process[auxDependsprocessLength]) {
            case 'string':

              if(depends_process[auxDependsprocessLength] === planProcess[planProcessLength].id){
                if(!planProcess[planProcessLength].isEnded()){
                  action = 'wait';
                }else{
                  if(planProcess[planProcessLength].isErrored()){
                    action = 'wait';
                  }else{
                    action = 'run';
                  }
                }
              }

              break;
            case 'object':
              if(!depends_process[auxDependsprocessLength].hasOwnProperty('file_name')){

                if(depends_process[auxDependsprocessLength].id === planProcess[planProcessLength].id){

                  if(!planProcess[planProcessLength].isEnded()){
                    action = 'wait';
                  }else{
                    var on_fail = false;
                    if(depends_process[auxDependsprocessLength].hasOwnProperty('on_fail')){
                      on_fail = depends_process[auxDependsprocessLength].on_fail;
                    }

                    if(planProcess[planProcessLength].isErrored()){
                      if(on_fail){
                        action = 'run';
                      }else{
                        action = 'wait';
                      }
                    }else{
                      if(on_fail){
                        action = 'end';
                      }else{
                        action = 'run';
                      }
                    }
                  }
                }
              }
              break;
          }
        }
      }
      return action;
    }else{
      return action;
    }
  }

/*
  hasProcessDependecies(process){
    var _this = this;
    var hasDependencies = false;
    var processesDependencies = [];

    if(process.hasOwnProperty('depends_process') && process.depends_process.length > 0){
      var depends_process = process.depends_process;
      var planProcess = this.processes;

      var dependsprocessLength = depends_process.length;

      //File dependences:
      // Check process dependencies
      while(dependsprocessLength--) {
        if (typeof depends_process[dependsprocessLength]) {
          if(depends_process[dependsprocessLength].hasOwnProperty('file_name')){
            // If any depends files is ready
            if(process.depends_files_ready){

              // Check if all process depends files is ready
              var depends_files_ready_length = process.depends_files_ready.length;
              var dependenceFound = false;

              while(depends_files_ready_length--){
                // Using anumatch to check regular expression glob:
               if (anymatch([depends_process[dependsprocessLength].file_name], process.depends_files_ready[depends_files_ready_length])){
                 dependenceFound = true;
               }
              }

              if (!dependenceFound){
                processesDependencies.push(depends_process[dependsprocessLength]);
                hasDependencies = true;
              }
            }else{
              processesDependencies.push(depends_process);
              hasDependencies = true;
            }
          }
        }
      }

      //Process dependences:
      var planProcessLength = this.processes.length;
      dependsprocessLength = depends_process.length;
      while(planProcessLength--){
        var auxDependsprocessLength = dependsprocessLength;

        while(auxDependsprocessLength--){
          switch (typeof depends_process[auxDependsprocessLength]) {
            case 'string':
              if(depends_process[auxDependsprocessLength] === planProcess[planProcessLength].id){
                if(!planProcess[planProcessLength].isEnded()){
                  processesDependencies.push(planProcess[planProcessLength]);
                  hasDependencies = true;
                }
              }

              break;
            case 'object':
              if(depends_process[auxDependsprocessLength].hasOwnProperty('file_name')){

              }else{
                if(depends_process[auxDependsprocessLength].id === planProcess[planProcessLength].id){
                  if(planProcess[planProcessLength].isEnded() || (depends_process[auxDependsprocessLength].ignore_fail && planProcess[planProcessLength].isErrored())){
                  }else{
                    processesDependencies.push(planProcess[planProcessLength]);
                    hasDependencies = true;
                  }
                }
              }
              break;
          }
        }
      }
      return processesDependencies;
    }else{
      return processesDependencies;
    }
  }
  */
}

class Plan{
  constructor(version, chains){
    this.version = version;
    this.chains;
    return new Promise((resolve) => {
      this.loadChains(chains)
        .then((chains) => {
          this.chains = chains;
          resolve(this);
        })
        .catch(function(e){
          logger.log('error','Plan constructor:'+e);
          resolve(this);
      });
    });
  }

  loadChains(chains){
    var _this = this;
    return new Promise((resolve) => {
      if (chains instanceof Array) {
        var chainLength = chains.length;
        if (chainLength > 0) {
          var planChainsPromises = [];

          while(chainLength--){
            var chain = chains[chainLength];

            planChainsPromises.push(_this.loadChain(chain));

            /*
            planChainsPromesas.push(new Chain(chain.id,
                                              chain.name,
                                              chain.start_date,
                                              chain.end_date,
                                              chain.schedule_interval,
                                              chain.prevent_overlap,
                                              chain.depends_chains,
                                              chain.depends_chains_alt,
                                              chain.events,
                                              chain.processes,
                                              chain.status,
                                              chain.started_at,
                                              chain.ended_at));
            */
          }

          Promise.all(planChainsPromises)
            .then(function(chains) {

              var chainsLength = chains.length;
              while(chainsLength--){
                _this.loadChainFileDependencies(chains[chainsLength]);
              }
              resolve(chains);
            })
            .catch(function(e){
              logger.log('error','Loading chains:'+e);
              resolve();
            });

        }else{
          logger.log('error','Plan have not Chains');
          resolve();
        }
      }else{
        logger.log('error','Chain, processes is not array');
        resolve();
      }
    });
  }

  loadChain(chain){
    return new Promise((resolve) => {

      new Chain(chain.id,
                chain.name,
                chain.start_date,
                chain.end_date,
                chain.schedule_interval,
                chain.prevent_overlap,
                chain.depends_chains,
                chain.depends_chains_alt,
                chain.events,
                chain.processes,
                chain.status,
                chain.started_at,
                chain.ended_at)
          .then(function(res) {
            resolve(res);
          })
          .catch(function(e){
            logger.log('error','Loading chain:'+e);
            resolve();
          });
    });
  }

  loadChainFileDependencies(chain){
    var _this = this;

    var depends_chain = chain.depends_chains;
    var dependsChainLength = depends_chain.length;

    if (dependsChainLength > 0) {
      while (dependsChainLength--) {
        var dependence = depends_chain[dependsChainLength];

        if(dependence instanceof Object){
          if(dependence.hasOwnProperty('file_name') && dependence.hasOwnProperty('condition')){

            //TODO: VALIDATE CONDITIONS VALUES

            var watcher = chokidar.watch(dependence.file_name, { ignored: /[\/\\](\.|\~)/,
              persistent: true,
              usePolling: true,
              awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 150
              }
            });

            watcher.on(dependence.condition, function(pathfile) {
              if(chain.depends_files_ready){
                chain.depends_files_ready.push(pathfile);
              }else{
                chain.depends_files_ready = [pathfile];
              }

              if(!chain.isRunning() && !chain.isErrored()){
               _this.planificateChain(chain);
              }

            })

            if(process.file_watchers){
              process.file_watchers.push(watcher);
            }else{
              process.file_watchers = [watcher];
            }

          }
        }
      }
    }
  }

  planificateChains(){
    var _this = this;
    var planChainsLength = this.chains.length;
    while(planChainsLength--) {
      var chain = this.chains[planChainsLength];
      _this.planificateChain(chain);
    }
  };

  planificateChain(chain){
    var _this = this;
    // Cuando llega una cadena con running pero sin scheduleRepeater la cadena debe volver a empezar
    // Espero que se den por ejecutados los procesos con estado "end" y así continue la ejecución por donde debe:

    if(chain.schedule_interval !== undefined && chain.scheduleRepeater === undefined){
      chain.stop();
    };

    if ((!chain.hasOwnProperty('end_date') || (chain.hasOwnProperty('end_date') && new Date(chain.end_date) > new Date())) && (chain.isStoped()))
    {
      if(chain.hasOwnProperty('start_date')){

        logger.log('debug', `PLANIFICADA CADENA ${chain.id} EN ${(new Date(chain.start_date))}`);

        if ((new Date(chain.start_date)) <= (new Date())){

          logger.log('debug', `start_date: ${(new Date(chain.start_date)) } / now: ${(new Date())}`);


          logger.log('debug', `INTENTANDO INICIAR CADENA ${chain.id} EN ${(new Date(chain.start_date))}`);

          if(_this.hasDependenciesBlocking(chain)){
            chain.waiting_dependencies();
            logger.log('warn', `Ejecutar cadena ${chain.id} -> on_waiting_dependencies`);
          }else{
            chain.start()
              .then(function() {
                _this.planificateChains()
              })
              .catch(function(e){logger.log('error','Error '+e)});
          }
        }else{
          // Will execute in start_date set
          chain.schedule = schedule.scheduleJob(new Date(chain.start_date), function(chain){
            if(_this.hasDependenciesBlocking(chain)){
              chain.waiting_dependencies();
              logger.log('debug', `Ejecutar a FUTURO ${chain.id} -> on_waiting_dependencies`);
            }else{
              logger.log('debug', `Ejecutar a FUTURO ${chain.id} -> start`);
              chain.start()
                .then(function() {
                  _this.planificateChains()
                })
                .catch(function(e){logger.log('error','Error '+e)});
            }
          }.bind(null,chain));
        }

        // Remove Chain from pool
        if(chain.hasOwnProperty('end_date')){

          logger.log('debug',`PLANIFICADA CANCELACION DE CADENA ${chain.id} EN ${(new Date(chain.end_date))}`);

          chain.scheduleCancel = schedule.scheduleJob(new Date(chain.end_date), function(chain){

            logger.log('debug',`CANCELANDO CADENA ${chain.id}`);

            chain.schedule.cancel();

          }.bind(null,chain));
        }

      }else{
        logger.log('error',`Invalid PlanFile, chain ${chain.id} don´t have start_date.`);
        throw new Error(`Invalid PlanFile, chain ${chain.id} don´t have start_date.`);
      }
    }else{
      logger.log('warn',`CHAIN ${chain.id} IGNORED: END_DATE ${chain.end_date} < CURRENT DATE: `,new Date(),'-  chain.status:'+chain.status,'- chain.schedule_interval:',chain.schedule_interval,'- chain.scheduleRepeater:',(chain.scheduleRepeater===undefined));
    }
  };

  getChainById(chainId){
    var _this = this;

    function byId(chain){
      return chain.id === chainId;
    }

    return _this.chains.find(byId);
  }

  getIndexChainById(chainId){
    var _this = this;

    function byId(chain){
      return chain.id === chainId;
    }

    return _this.chains.findIndex(byId);
  }

  // Load a Chain. If exists replace and If not exists add the chain:
  loadChainToPlan(newChain){

    var _this = this;
    var chainId = newChain.id;
    var indexChain = _this.getIndexChainById(chainId);

    if(indexChain > -1){
      _this.chains[indexChain] = newChain;
    }else{
      _this.chains.push(newChain);
    }
    // Planificate load/reload chain
    _this.planificateChain(_this.getChainById(chainId));
  }

  dependenciesBlocking(chain){

    var hasDependencies = false;
    var chainsDependencies = [];

    if(chain.hasOwnProperty('depends_chains') && chain.depends_chains.length > 0){
      var depends_chains = chain.depends_chains;
      var planChains = this.chains;

      var planChainsLength = this.chains.length;
      var dependsChainsLength = depends_chains.length;

      //File dependences:
      while(dependsChainsLength--) {
        if (typeof depends_chains[dependsChainsLength]) {
          if(depends_chains[dependsChainsLength].hasOwnProperty('file_name')){
            if(chain.depends_files_ready){

              console.log('> chain.depends_files_ready:',chain.depends_files_ready);
              console.log('> depends_chains[dependsChainsLength].file_name:',depends_chains[dependsChainsLength].file_name);

              if(chain.depends_files_ready.indexOf(depends_chains[dependsChainsLength].file_name) > -1){
              }else{
                chainsDependencies.push(depends_chains[dependsChainsLength]);
                hasDependencies = true;
              }
            }else{
              chainsDependencies.push(depends_chains);
              hasDependencies = true;
            }
          }
        }
      }

      //Chains dependences:
      dependsChainsLength = depends_chains.length;

      while(planChainsLength--){
        var auxDependsChainsLength = dependsChainsLength;

        while(auxDependsChainsLength--){
          switch (typeof depends_chains[auxDependsChainsLength]) {
            case 'string':
              if(depends_chains[auxDependsChainsLength] === planChains[planChainsLength].id){
                if(!planChains[planChainsLength].isEnded()){
                  chainsDependencies.push(planChains[planChainsLength]);
                  hasDependencies = true;
                }
              }
              break;
            case 'object':
              if(depends_chains[auxDependsChainsLength].id === planChains[planChainsLength].id){
                if(planChains[planChainsLength].isEnded() || (depends_chains[auxDependsChainsLength].ignore_fail && planChains[planChainsLength].isErrored())){
                }else{
                  chainsDependencies.push(planChains[planChainsLength]);
                  hasDependencies = true;
                }
              }
              break;
          }
        }
      }
      return chainsDependencies;
    }else{
      return chainsDependencies;
    }
  }

  hasDependenciesBlocking(chain){
    return (this.dependenciesBlocking(chain).length > 0);
  }

};


class FilePlan {
  constructor(filePath){
    this.filePath = filePath;
    this.fileContent;
    this.lastHashPlan;
    this.plan;

    return new Promise((resolve) => {
      var _this = this;
      this.loadFileContent(filePath)
        .then((res) => {
        _this.fileContent = res;
        _this.getChains(res)
          .then((chains) => {
          new Plan('', chains)
            .then(function(plan){
              _this.plan = plan;
              _this.plan.planificateChains();
              _this.startAutoRefreshBinBackup();
              resolve(_this);
            })
            .catch(function(err){
              logger.log('error','FilePlan new Plan: '+err);
              resolve();
            })
        })
        .catch(function(err){
            logger.log('error','FilePlan loadFileContent getChains: '+err);
            resolve();
          });
        })
        .catch(function(e){
          logger.log('error','File Plan, constructor:'+e)
          resolve(this);
        });
    });
  }

  loadFileContent(filePath){
    var _this = this;
    return new Promise((resolve) => {
      fs.stat(filePath, function(err, res){
        if(err){
          logger.log('error',`Plan file ${filePath} not exists.`, err);
          throw new Error(`PlanFile ${filePath} not found.`);
          resolve();
        }else{
          try {
            fs.readFile(filePath, 'utf8', function(err, res){
              if(err){
                logger.log('error','FilePlan loadFileContent readFile: '+err);
                resolve();
              }else{
                resolve(JSON.parse(res));
              }
            });
          } catch(e) {
            throw new Error('Invalid PlanFile, incorrect JSON format: '+e.message,e);
            resolve();
          }
        }
      });
    });
  }

  getChains(json){
    return new Promise((resolve) => {

      if(json.hasOwnProperty('chains')){
        if(json.chains instanceof Array){
          resolve(this.validateChains(json));
        }else{
          throw new Error('Invalid PlanFile, chain is not an array.');
          resolve();
        }
      }else{
        throw new Error('Invalid PlanFile, chain property not found.');
        resolve();
      }

    });
  };

  validateChains(json){
    var correctChains = [];
    var chainsLength = json.chains.length;

    for (var i = 0; i < chainsLength; ++i) {
      var chain = json.chains[i];

      if(chain.hasOwnProperty('id') && chain.hasOwnProperty('name') && chain.hasOwnProperty('start_date')){
        correctChains.push(chain);
      }else{
        logger.log('error','Chain ignored, id, name or start_date is not set: ', chain);
      }

    }

    return correctChains;
  }

  refreshBinBackup(){
    var _this = this;
    var plan = _this.plan;

      var objStr = JSON.stringify(plan);
      var hashPlan = crypto.createHash('sha256').update(objStr).digest("hex");

      if(_this.lastHashPlan !== hashPlan){
        _this.lastHashPlan = hashPlan;
        logger.log('debug','> REFRESING hashPlan:',hashPlan);
        fs.writeFileSync('./bin.json', objStr, null);
      }
  }

  startAutoRefreshBinBackup(){
    var _this = this;
    setTimeout(function(){
      _this.refreshBinBackup();
    }, config.refreshIntervalBinBackup);
  }

};

// CLASES ----- END ------

logger.log('info',`RUNNERTY RUNNING - TIME...: ${new Date()}`);

var runtimePlan;
var fileLoad = config.binBackup;
var reloadMode = false;

// CHECK ARGS APP:
process.argv.forEach(function (val, index, array) {
  if (index === 2 && val === 'reload'){
    reloadMode = true;
  }else{
    if (index === 3 && val !== ''){
      fileLoad = val;
    }
  }
});

if(reloadMode){
  fileLoad = config.planFilePath;
  logger.log('warn',`Reloading plan from ${fileLoad}`);
}

new FilePlan(fileLoad)
  .then(function(plan){
    runtimePlan = plan;
    require('./api/api.js')(config, logger, runtimePlan);
  })
  .catch(function(e){
    logger.log('error','FilePlan: '+e);
  });

//==================================================================
//
process.on('uncaughtException', function (err) {
  logger.log('error',err.stack);
});

process.on('exit', function (err) {
  logger.log('warn','--> [R]unnerty stoped.', err);
});


// TODO -->
// LOGS EN S3
// CONFIGURACIONES GENERALES DE: BD, SLACK, MAIL, S3 (ya ejemplos en plan.json)
// EJECUCIÓN DE SENTENCIAS SIMPLES SQL A BDS (MYSQL Y POSTGRES?)
//
