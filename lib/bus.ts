import EventEmitter from 'events';
import constants from './constants';
import stdDbusIfaces from './stdifaces';
import introspect from './introspect';

private class SignalMessage {
    body: any;
    signature: any;
    path: any;
    member: any;
    interface: any;
    optional serial: number;
    type: any;

}

export class Bus {

    private serial=1;
    private cookies={};
    private methodCallHandlers = {};
    private signals = new EventEmitter();
    private exportedObjects = {};

    constructor(private connection, private opts) {
        connection.on('message', function (msg) {
            this.connection_on(msg);
        });
    }

    // fast access to tree formed from object paths names
    // this.exportedObjectsTree = { root: null, children: {} };

    public invoke(msg, callback) {
        if (!msg.type)
            msg.type = constants.MessageType.methodCall;
        msg.serial = this.serial;
        this.serial++;
        this.cookies[msg.serial] = callback;
        this.connection.message(msg);
    };

    public invokeDbus(msg, callback) {
        if (!msg.path)
            msg.path = '/org/freedesktop/DBus';
        if (!msg.destination)
            msg.destination = 'org.freedesktop.DBus';
        if (!msg['interface'])
            msg['interface'] = 'org.freedesktop.DBus';
        this.invoke(msg, callback);
    };

    private mangle(path, iface, member) {
        var obj = {};
        if (typeof path === 'object') // handle one argumant case mangle(msg)
        {
            obj.path = path.path;
            obj['interface'] = path['interface'];
            obj.member = path.member;
        } else {
            obj.path = path;
            obj['interface'] = iface;
            obj.member = member;
        }
        return JSON.stringify(obj);
    };

    private sendSignal(path, iface, name, signature, args) {
        let signalMsg = new SignalMessage();
        signalMsg.type=constants.messageType.signal;
        signalMsg.serial=this.serial;
        signalMsg.interface=iface;
        signalMsg.path=path;
        signalMsg.member=name;
        if (signature) {
            signalMsg.signature = signature;
            signalMsg.body = args;
        }
        this.connection.message(signalMsg);
    }

    // Warning: errorName must respect the same rules as interface names (must contain a dot)
    private sendError(msg, errorName, errorText) {
        var reply = {
            type: constants.messageType.error,
            replySerial: msg.serial,
            destination: msg.sender,
            errorName: errorName,
            signature: 's',
            body: [errorText]
        };
        //console.log('SEND ERROR', reply);
        this.connection.message(reply);
    }

    private sendReply(msg, signature, body) {
        var reply = {
            type: constants.messageType.methodReturn,
            replySerial: msg.serial,
            destination: msg.sender,
            signature: signature,
            body: body
        };
        this.connection.message(reply)
    }

    // route reply/error
    private connection_on (msg) {
        let handler =  {};
        if (this.exportedObjects!==undefined&& this.exportedObjects[msg.path]) 
            { 
                // methodCall
                if (stdDbusIfaces(msg, self))
                    return;

                // exported interfaces handlers
                var obj, iface, impl;
                if (obj = this.exportedObjects[msg.path]) {

                    if (iface = obj[msg['interface']]) {
                        // now we are ready to serve msg.member
                        impl = iface[1];
                        var func = impl[msg.member];
                        if (!func) {
                            // TODO: respond with standard dbus error
                            console.error('Method ' + msg.member + ' is not implemented ');
                            throw new Error('Method ' + msg.member + ' is not implemented ');
                        };
                        try {
                            result = func.apply(impl, msg.body);
                        } catch (e) {
                            console.error("Caught exception while trying to execute handler: ", e);
                            throw e;
                        }
                        // TODO safety check here
                        var resultSignature = iface[0].methods[msg.member][1];
                        var reply = {
                            type: constants.messageType.methodReturn,
                            destination: msg.sender,
                            replySerial: msg.serial
                        };
                        if (result) {
                            reply.signature = resultSignature;
                            reply.body = [result];
                        }
                        self.connection.message(reply);
                        return;
                    } else {
                        console.error('Interface ' + msg['interface'] + ' is not supported');
                        // TODO: respond with standard dbus error
                    }
                }
                // setMethodCall handlers
                handler = self.methodCallHandlers[self.mangle(msg)];
                if (handler) {
                    var result;
                    try {
                        result = handler[0].apply(null, msg.body);
                    } catch (e) {
                        console.error("Caught exception while trying to execute handler: ", e);
                        self.sendError(e.message, e.description);
                        return;
                    }
                    var reply = {
                        type: constants.messageType.methodReturn,
                        destination: msg.sender,
                        replySerial: msg.serial
                        //, sender: self.name
                    };
                    if (result) {
                        reply.signature = handler[1];
                        reply.body = result;
                    }
                    self.connection.message(reply);
                } else {
                    self.sendError(msg, 'org.freedesktop.DBus.Error.UnknownService', 'Uh oh oh');
                }

            }
       else if (msg.type == constants.messageType.methodReturn || msg.type == constants.messageType.error) {

                handler = self.cookies[msg.replySerial];
                if (handler) {
                    delete self.cookies[msg.replySerial];
                    var props = {
                        connection: self.connection,
                        bus: self,
                        message: msg,
                        signature: msg.signature
                    };
                    var args = msg.body || [];
                    if (msg.type == constants.messageType.methodReturn) {

                        args = [null].concat(args); // first argument - no errors, null
                        handler.apply(props, args); // body as array of arguments
                    } else {
                        handler.call(props, args);  // body as first argument
                    }
                }
            } else if (msg.type == constants.messageType.signal) {
                self.signals.emit(self.mangle(msg), msg.body, msg.signature);
            }  
    });

    private setMethodCallHandler (objectPath, iface, member, handler) {
        var key = this.mangle(objectPath, iface, member);
        this.methodCallHandlers[key] = handler;
    };

    private exportInterface (obj, path, iface) {
        var entry;
        if (!this.exportedObjects[path])
            entry = this.exportedObjects[path] = {};
        else
            entry = this.exportedObjects[path];
        entry[iface.name] = [iface, obj];

        // monkey-patch obj.emit()
        if (typeof obj.emit === 'function') {
            var oldEmit = obj.emit;
            obj.emit = function () {
                var args = Array.prototype.slice.apply(arguments);
                var signalName = args[0];
                if (!signalName)
                    throw new Error('Trying to emit undefined signa');

                //send signal to bus
                var signal;
                if (iface.signals && iface.signals[signalName]) {
                    signal = iface.signals[signalName];
                    //console.log(iface.signals, iface.signals[signalName]);
                    var signalMsg = {
                        type: constants.messageType.signal,
                        serial: this.serial,
                        'interface': iface.name,
                        path: path,
                        member: signalName
                    };
                    if (signal[0]) {
                        signalMsg.signature = signal[0];
                        signalMsg.body = args.slice(1);
                    }
                    this.connection.message(signalMsg);
                    this.serial++;
                }
                // note that local emit is likely to be called before signal arrives
                // to remote subscriber
                oldEmit.apply(obj, args);
            };
        }
        // TODO: emit ObjectManager's InterfaceAdded
    };

    // register name
    if (opts.direct !== true) {
        this.invokeDbus({ member: 'Hello' }, function (err, name) {
            if (err) throw new Error(err);
            self.name = name;
        });
    } else {
        self.name = null;
    }

    function DBusObject(name, service) {
        this.name = name;
        this.service = service;
        this.as = function (name) {
            return this.proxy[name];
        };
    }

    function DBusService(name, bus) {
        this.name = name;
        this.bus = bus;
        this.getObject = function (name, callback) {
            var obj = new DBusObject(name, this);
            //console.log(obj);
            introspect(obj, function (err, ifaces, nodes) {
                if (err) return callback(err);
                obj.proxy = ifaces;
                obj.nodes = nodes;
                callback(null, obj);
            });
        };

        this.getInterface = function (objName, ifaceName, callback) {
            this.getObject(objName, function (err, obj) {
                if (err) return callback(err);
                callback(null, obj.as(ifaceName));
            });
        };
    }

    this.getService = function (name) {
        return new DBusService(name, this);
    };

    this.getObject = function (path, name, callback) {
        var service = this.getService(path);
        return service.getObject(name, callback);
    };

    this.getInterface = function (path, objname, name, callback) {
        return this.getObject(path, objname, function (err, obj) {
            if (err) return callback(err);
            callback(null, obj.as(name));
        });
    };

    // TODO: refactor

    // bus meta functions
    this.addMatch = function (match, callback) {
        if (!self.name) return callback(null, null);
        this.invokeDbus({ 'member': 'AddMatch', signature: 's', body: [match] }, callback);
    };

    this.removeMatch = function (match, callback) {
        if (!self.name) return callback(null, null);
        this.invokeDbus({ 'member': 'RemoveMatch', signature: 's', body: [match] }, callback);
    };

    this.getId = function (callback) {
        this.invokeDbus({ 'member': 'GetId' }, callback);
    };

    this.requestName = function (name, flags, callback) {
        this.invokeDbus({ 'member': 'RequestName', signature: 'su', body: [name, flags] }, function (err, name) {
            //self.name = name;
            if (callback)
                callback(err, name);
        });
    };

    this.releaseName = function (name, callback) {
        this.invokeDbus({ 'member': 'ReleaseName', signature: 's', body: [name] }, callback);
    };

    this.listNames = function (callback) {
        this.invokeDbus({ 'member': 'ListNames' }, callback);
    };

    this.listActivatableNames = function (callback) {
        this.invokeDbus({ 'member': 'ListActivatableNames', signature: 's', body: [name] }, callback);
    };

    this.updateActivationEnvironment = function (env, callback) {
        this.invokeDbus({ 'member': 'UpdateActivationEnvironment', signature: 'a{ss}', body: [env] }, callback);
    };

    this.startServiceByName = function (name, flags, callback) {
        this.invokeDbus({ 'member': 'StartServiceByName', signature: 'su', body: [name, flags] }, callback);
    };

    this.getConnectionUnixUser = function (name, callback) {
        this.invokeDbus({ 'member': 'GetConnectionUnixUser', signature: 's', body: [name] }, callback);
    };

    this.getConnectionUnixProcessId = function (name, callback) {
        this.invokeDbus({ 'member': 'GetConnectionUnixProcessID', signature: 's', body: [name] }, callback);
    };

    this.getNameOwner = function (name, callback) {
        this.invokeDbus({ 'member': 'GetNameOwner', signature: 's', body: [name] }, callback);
    };

    this.nameHasOwner = function (name, callback) {
        this.invokeDbus({ 'member': 'NameHasOwner', signature: 's', body: [name] }, callback);
    };
};
