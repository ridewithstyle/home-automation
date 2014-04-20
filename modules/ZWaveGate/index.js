/*** ZWave Gate module ********************************************************

Version: 2.0.0
-------------------------------------------------------------------------------
Author: Serguei Poltorak <ps@z-wave.me>
Copyright: (c) Z-Wave.Me, 2014

******************************************************************************/

function ZWaveGate (id, controller) {
    ZWaveGate.super_.call(this, id, controller);

    this.ZWAY_DEVICE_CHANGE_TYPES = {
        "DeviceAdded": 0x01,
        "DeviceRemoved": 0x02,
        "InstanceAdded": 0x04,
        "InstanceRemoved": 0x08,
        "CommandAdded": 0x10,
        "CommandRemoved": 0x20
    };
    
    this.ZWAY_DATA_CHANGE_TYPE = {
        "Updated": 0x01,       // Value updated or child created
        "Invalidated": 0x02,   // Value invalidated
        "Deleted": 0x03,       // Data holder deleted - callback is called last time before being deleted
        "ChildCreated": 0x04,  // New direct child node created
        
        // ORed flags
        "PhantomUpdate": 0x40, // Data holder updated with same value (only updateTime changed)
        "ChildEvent": 0x80     // Event from child node
    };
    
    this.CC = {
        "Basic": 0x20,
        "SwitchBinary": 0x25,
        "SwitchMultilevel": 0x26,
        "SceneActivation": 0x2b,
        "SensorBinary": 0x30,
        "SensorMultilevel": 0x31,
        "Meter": 0x32,
        "ThermostatMode": 0x40,
        "ThermostatSetPoint": 0x43,
        "ThermostatFanMode": 0x44,
        "DoorLock": 0x62,
        "Battery": 0x80
    };

    this.dataBinding = [];
    this.zwayBinding = null;
}

// Module inheritance and setup

inherits(ZWaveGate, AutomationModule);

_module = ZWaveGate;


ZWaveGate.prototype.init = function (config) {
    ZWaveGate.super_.prototype.init.call(this, config);

    var self = this;    
    
    // Bind to all future CommandClasses changes
    this.zwayBinding = zway.bind(function (type, nodeId, instanceId, commandClassId) {
        if (type === self.ZWAY_DEVICE_CHANGE_TYPES["CommandAdded"]) {
           self.dataBind(nodeId, instanceId, commandClassId, "interviewDone", function() {
                if (this.value === true) {
                    self.parseAddCommandClass(nodeId, instanceId, commandClassId);
                } else {
                    self.parseDelCommandClass(nodeId, instanceId, commandClassId);
                }
            }, "value");
        } else {
            self.parseDelCommandClass(nodeId, instanceId, commandClassId);
        }
    }, this.ZWAY_DEVICE_CHANGE_TYPES["CommandAdded"] | this.ZWAY_DEVICE_CHANGE_TYPES["CommandRemoved"]);
 
    // Iterate all existing Command Classes
    Object.keys(zway.devices).forEach(function (nodeId) {
        nodeId = parseInt(nodeId, 10);
        var device = zway.devices[nodeId];

        // Ignore Static PC Controllers
        if (2 === device.data.basicType.value && 1 === device.data.specificType.value) {
            console.log("Device", nodeId, "is a Static PC Controller, ignoring");
            return;
        }

        Object.keys(device.instances).forEach(function (instanceId) {
            instanceId = parseInt(instanceId, 10);
            var instance = device.instances[instanceId];

            Object.keys(instance.commandClasses).forEach(function (commandClassId) {
                commandClassId = parseInt(commandClassId, 10);
                var commandClass = instance.commandClasses[commandClassId];

                self.dataBind(nodeId, instanceId, commandClassId, "interviewDone", function() {
                    if (this.value === true) {
                        self.parseAddCommandClass(nodeId, instanceId, commandClassId);
                    } else {
                        self.parseDelCommandClass(nodeId, instanceId, commandClassId);
                    }
                }, "value");                    
            });
        });
    });
};

ZWaveGate.prototype.stop = function () {
    console.log("--- ZWaveGate.stop()");
    ZWaveGate.super_.prototype.stop.call(this);

    // releasing bindings
    this.dataBinding.forEach(function (item) {
        zway.devices[item.nodeId].instances[item.instanceId].commandClasses[item.commandClassId].data[item.path].unbind(item.func);
    });
    zway.unbind(this.zwayBinding);
};

// Module methods

ZWaveGate.prototype.dataBind = function(nodeId, instanceId, commandClassId, path, func, type) {
    var cc = zway.devices[nodeId].instances[instanceId].commandClasses[commandClassId].data,
        ccc = cc,
        pathArr = path ? path.split(".") : [];

    if (!func) {
        console.log("Function passed to dataBind is undefined");
        return;
    }

    ccc = ccc[pathArr.shift()];
    if (ccc) {
        this.dataBinding.push({
            "nodeId": nodeId,
            "instanceId": instanceId,
            "commandClassId": commandClassId,
            "path": path,
            "func": ccc.bind(func, type === "value" ? this.ZWAY_DATA_CHANGE_TYPE.Updated : this.ZWAY_DATA_CHANGE_TYPE.ChildCreated)
        });
        if (type === "value") {
            func.call(ccc, this.ZWAY_DATA_CHANGE_TYPE.Updated);
        }
    } else {
        console.log("Can not find data path:", nodeId, instanceId, commandClassId, path);
    }
};

ZWaveGate.prototype.parseAddCommandClass = function (nodeId, instanceId, commandClassId) {
    nodeId = parseInt(nodeId, 10);
    instanceId = parseInt(instanceId, 10);
    commandClassId = parseInt(commandClassId, 10);

    var self = this,
        instance = zway.devices[nodeId].instances[instanceId],
        instanceCommandClasses = Object.keys(instance.commandClasses),
        cc = instance.commandClasses[commandClassId],
        vDevIdPrefix = "ZWayVDev_",
        vDevIdMidfix = nodeId + ":" + instanceId + ":",
        vDevIdPostfix = commandClassId,
        vDevId = vDevIdPrefix + vDevIdMidfix + vDevIdPostfix,
        vDev = null,
        defaults;

/*
    !!! Thermostat widget
    
    if (in_array(instanceCommandClasses, "64") || in_array(instanceCommandClasses, "67")) {
        deviceName = "ZWayVDev_" + nodeId + ":" + instanceId + ":Thermostat";

        if (self.controller.deviceExists(deviceName)) {
            return;
        }

        console.log("Creating Thermostat device");
        instanceDevices.push(new ZWaveThermostatDevice(deviceName, self.controller, nodeId, instanceId));
    }
*/

    // Ignore SwitchBinary if SwitchMultilevel exists
    if (this.CC["SwitchBinary"] === commandClassId && in_array(instanceCommandClasses, this.CC["SwitchMultilevel"])) {
        console.log("Ignoring SwitchBinary due to SwitchMultilevel existence");
        return;
    }
    if (this.CC["SwitchMultilevel"] === commandClassId && this.controller.collection.get(vDevIdPrefix + vDevIdMidfix + this.CC["SwitchBinary"])) {
        console.log("Removing SwitchBinary due to SwitchMultilevel existence");
        this.controller.collection.remove(vDevIdPrefix + vDevIdMidfix + this.CC["SwitchBinary"]);
        return;
    }

    /*
    This check should be done in collection.create - this is used in sensors rendering
    // Do not recreate device twice
    if (self.controller.collection.get(vDevId)) {
        console.log("Not duplicating vDev " + vDevId);
        return;
    }
    */

    if (this.CC["SwitchBinary"] === commandClassId) {
        defaults = {
            deviceType: "switchBinary",
            metrics: {
                probeTitle: '',
                scaleTitle: '',
                level: '',
                icon: 'switch',
                title: 'Switch' + vDevIdMidfix
            }
        };
        vDev = self.controller.collection.create(vDevId, defaults, function (command) {
            if ("on" === command) {
                cc.Set(true);
            } else if ("off" === command) {
                cc.Set(false);
            }
        });
        if (vDev) {
            self.dataBind(nodeId, instanceId, commandClassId, "level", function () {
                vDev.setMetricValue("level", this.value ? "on" : "off");
            }, "value");
        }
    } else if (this.CC["SwitchMultilevel"] === commandClassId) {
        defaults = {
            deviceType: "switchMultilevel",
            metrics: {
                probeTitle: '',
                scaleTitle: '',
                level: '',
                icon: 'multilevel',
                title: 'Dimmer' + vDevIdMidfix
            }
        };
        vDev = self.controller.collection.create(vDevId, defaults, function(command, args) {
            var newVal;
            if ("on" === command) {
                newVal = 255;
            } else if ("off" === command) {
                newVal = 0;
            } else if ("min" === command) {
                newVal = 10;
            } else if ("max" === command) {
                newVal = 99;
            } else if ("increase" === command) {
                newVal = this.metrics.level+10;
                if (0 !== newVal%10) {
                    newVal = Math.round(newVal/10)*10;
                }
                if (newVal > 99) newVal = 99;
            } else if ("decrease" === command) {
                newVal = this.metrics.level-10;
                if (newVal < 0) newVal = 0;
                if (0 !== newVal%10) {
                    newVal = Math.round(newVal/10)*10;
                }
            } else if ("exact" === command) {
                newVal = parseInt(args["level"], 10);
                if (newVal < 0) {
                    newVal = 0
                } else if(newVal == 255) {
                    newVal = 255;
                } else if (newVal > 99) {
                    newVal = null;
                }
            }

            if (0 === newVal || !!newVal) {
                cc.Set(newVal);
            }
        });
        if (vDev) {
            self.dataBind(nodeId, instanceId, commandClassId, "level", function() {
                vDev.setMetricValue("level", this.value);
            }, "value");
        }
    } else if (this.CC["SensorBinary"] === commandClassId) {
        defaults = {
            deviceType: 'sensor',
            metrics: {
                probeTitle: '',
                icon: 'sensor',
                level: '',
                title: ''
            }
        };
        Object.keys(cc.data).forEach(function (sensorTypeId) {
            sensorTypeId = parseInt(sensorTypeId, 10);
            if (!isNaN(sensorTypeId)) {
                defaults.metrics.title =  'Sensor' + vDevIdMidfix + vDevIdPostfix + ":" + sensorTypeId;
                vDev = self.controller.collection.create(vDevId, defaults);
                if (vDev) {
                    self.dataBind(nodeId, instanceId, commandClassId, sensorTypeId + ".level", function() {
                        vDev.setMetricValue("level", this.value ? "on" : "off");
                    }, "value");
                    vDev.setMetricValue("probeTitle", cc.data[sensorTypeId].sensorTypeString.value);
                }
            }
        });        
        self.dataBind(nodeId, instanceId, commandClassId, "", function() {
            self.parseAddCommandClass(nodeId, instanceId, commandClassId);
        }, "child");
    } else if (this.CC["SensorMultilevel"] === commandClassId) {
        defaults = {
            deviceType: "probe",
            metrics: {
                probeTitle: '',
                scaleTitle: '',
                level: '',
                icon: 'sensor',
                title: ''
            }
        };
        Object.keys(cc.data).forEach(function (sensorTypeId) {
            sensorTypeId = parseInt(sensorTypeId, 10);
            if (!isNaN(sensorTypeId)) {
                defaults.metrics.title =  'Sensor' + vDevIdMidfix + vDevIdPostfix + ":" + sensorTypeId;
                vDev = self.controller.collection.create(vDevId, defaults);
                if (vDev) {
                    self.dataBind(nodeId, instanceId, commandClassId, sensorTypeId + ".val", function() {
                        vDev.setMetricValue("level", this.value);
                    }, "value");
                    vDev.setMetricValue("probeTitle", cc.data[sensorTypeId].sensorTypeString.value);
                    vDev.setMetricValue("scaleTitle", cc.data[sensorTypeId].scaleString.value);
                }
            }
        });        
        self.dataBind(nodeId, instanceId, commandClassId, "", function() {
            self.parseAddCommandClass(nodeId, instanceId, commandClassId);
        }, "child");
    } else if (this.CC["Meter"] === commandClassId) {
        defaults = {
            deviceType: 'probe',
            metrics: {
                probeTitle: '',
                scaleTitle: '',
                level: '',
                icon: 'probe',
                title: ''
            }
        };
        Object.keys(cc.data).forEach(function (scaleId) {
            scaleId = parseInt(scaleId, 10);
            if (!isNaN(scaleId)) {
                defaults.metrics.title =  'Meter' + vDevIdMidfix + vDevIdPostfix + ":" + scaleId;
                vDev = self.controller.collection.create(vDevId, defaults);
                if (vDev) {
                    self.dataBind(nodeId, instanceId, commandClassId, scaleId + ".val", function() {
                        vDev.setMetricValue("level", this.value);
                    }, "value");
                    vDev.setMetricValue("probeTitle", cc.data[scaleId].sensorTypeString.value);
                    vDev.setMetricValue("scaleTitle", cc.data[scaleId].scaleString.value);
                }
            }
        });        
        self.dataBind(nodeId, instanceId, commandClassId, "", function() {
            self.parseAddCommandClass(nodeId, instanceId, commandClassId);
        }, "child");
    } else if (this.CC["Battery"] === commandClassId) {
        defaults = {
            deviceType: 'battery',
            metrics: {
                probeTitle: 'Battery',
                scaleTitle: '%',
                level: '',
                icon: 'battery',
                title: 'Battery' + vDevIdMidfix
            }
        };
        vDev = self.controller.collection.create(vDevId, defaults);
        if (vDev) {
            self.dataBind(nodeId, instanceId, commandClassId, "last", function() {
                vDev.setMetricValue("level", this.value);
            }, "value");
        }
    } else if (this.CC["DoorLock"] === commandClassId) {
        defaults = {
            deviceType: 'doorlock',
            metrics: {
                mode: '',
                icon: 'door',
                title: 'Door Lock' + vDevIdMidfix
            }
        };

        vDev = self.controller.collection.create(vDevId, defaults, function(command) {
            if ("open" === command) {
                cc.Set(0);
            } else if ("close" === command) {
                cc.Set(255);
            }
        });
        if (vDev) {
            self.dataBind(nodeId, instanceId, commandClassId, "mode", function() {
                vDev.setMetricValue("mode", this.value === 255 ? "close" : "open");
            }, "value");
        }
    } else if (this.CC["ThermostatFanMode"] === commandClassId) {
        defaults = {
            deviceType: "fan",
            metrics: {
                level: '',
                icon: 'fan',
                title: 'Fan' + vDevIdMidfix
            }
        };
        vDev = self.controller.collection.create(vDevId, defaults, "fan");
        if (vDev) {
            self.dataBind(nodeId, instanceId, commandClassId, "mode", function() {
                vDev.setMetricValue("currentMode", this.value);
            }, "value");
            self.dataBind(nodeId, instanceId, commandClassId, "on", function() {
                vDev.setMetricValue("state", this.value);
            }, "value");

            var modes = {};
            Object.keys(cc.data).forEach(function (modeId) {
                modeId = parseInt(modeId, 10);
                if (!isNaN(modeId)) {
                    modes[modeId] = {
                        id: modeId,
                        title: cc.data[modeId].modeName.value
                    };
                }
            });  
            this.setMetricValue("modes", modes);
            // !!! изменение
        }
    }
    self.controller.collection.emit('ready');
};

ZWaveGate.prototype.parseDelCommandClass = function (nodeId, instanceId, commandClassId) {
    nodeId = parseInt(nodeId, 10);
    instanceId = parseInt(instanceId, 10);
    commandClassId = parseInt(commandClassId, 10);

    var self = this,
        vDevIdPrefix = "ZWayVDev_",
        vDevIdMidfix = nodeId + ":" + instanceId + ":",
        vDevIdPostfix = commandClassId,
        vDevId = vDevIdPrefix + vDevIdMidfix + vDevIdPostfix;

    this.controller.collection.remove(vDevId);
};
