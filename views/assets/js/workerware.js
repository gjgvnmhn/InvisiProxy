class WWError extends Error {
  constructor(message) {
    super(message);
    this.name = "";
  }
}

const WW_DEBUG = false;
const dbg = (...args) =>
  WW_DEBUG && console.log(...args);

const defaultOpt = {
  debug: false,
  randomNames: false,
  timing: false,
};

const validEvents = [
  'abortpayment',
  'activate',
  'backgroundfetchabort',
  'backgroundfetchclick',
  'backgroundfetchfail',
  'backgroundfetchsuccess',
  'canmakepayment',
  'contentdelete',
  'cookiechange',
  'fetch',
  'install',
  'message',
  'messageerror',
  'notificationclick',
  'notificationclose',
  'paymentrequest',
  'periodicsync',
  'push',
  'pushsubscriptionchange',
  'sync',
];

class WorkerWare {
  constructor(opt) {
    this._opt = Object.assign({}, defaultOpt, opt);
    this._middlewares = [];
  }
  info() {
    return {
      version: '0.2.0-invisi',
      middlewares: this._middlewares,
      options: this._opt,
    };
  }
  use(middleware) {
    const validateMW = this.validateMiddleware(middleware);
    if (validateMW.error) throw new WWError(validateMW.error);
    if (middleware.function.name === 'function')
      middleware.name = crypto.randomUUID();
    if (!middleware.name) middleware.name = middleware.function.name;
    if (this._opt.randomNames) middleware.name = crypto.randomUUID();
    if (this._opt.debug) dbg('Adding middleware:', middleware.name);
    this._middlewares.push(middleware);
  }
  run(event) {
    const middlewares = this._middlewares;
    const opt = this._opt;
    return async () => {
      const returnList = [];
      for (let i = 0; i < middlewares.length; i++) {
        const mw = middlewares[i];
        if (!mw.events.includes(event.type)) continue;
        if (mw.explicitCall) continue;
        event.workerware = { config: mw.configuration || {} };
        if (opt.timing) console.time(mw.name);
        let res;
        try {
          res = await mw.function(event);
        } catch (err) {
          console.error('middleware failed:', mw.name, err);
          res = undefined;
        }
        if (opt.timing) console.timeEnd(mw.name);
        if (res instanceof Response) {
          return res;
        }
        returnList.push(res);
      }
      return returnList;
    };
  }
  deleteByName(middlewareID) {
    this._middlewares = this._middlewares.filter(
      (mw) => mw.name !== middlewareID
    );
  }
  deleteByEvent(middlewareEvent) {
    this._middlewares = this._middlewares.filter(
      (mw) => !mw.events.includes(middlewareEvent)
    );
  }
  get() {
    return this._middlewares;
  }
  runMW(name, event) {
    const middlewares = this._middlewares;
    for (let i = 0; i < middlewares.length; i++) {
      if (middlewares[i].name === name) {
        event.workerware = {
          config: middlewares[i].configuration || {},
        };
        return middlewares[i].function(event);
      }
    }
    throw new WWError('Middleware not found!');
  }
  validateMiddleware(middleware) {
    if (!middleware.function) return { error: 'middleware.function is required' };
    if (typeof middleware.function !== 'function')
      return { error: 'middleware.function must be typeof function' };
    if (
      typeof middleware.configuration !== 'object' &&
      middleware.configuration !== undefined
    )
      return { error: 'middleware.configuration must be typeof object' };
    if (!middleware.events) return { error: 'middleware.events is required' };
    if (!Array.isArray(middleware.events))
      return { error: 'middleware.events must be an array' };
    if (middleware.events.some((ev) => !validEvents.includes(ev)))
      return {
        error:
          'Invalid event type! Must be one of the following: ' +
          validEvents.join(', '),
      };
    if (middleware.explicitCall && typeof middleware.explicitCall !== 'boolean')
      return { error: 'middleware.explicitCall must be typeof boolean' };
    return { error: undefined };
  }
}

self.WorkerWare = WorkerWare;
self.WWError = WWError;
