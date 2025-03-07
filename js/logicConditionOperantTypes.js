'use strict';

const OPERAND_TYPES = {
    0: {
        name: "Value",
        type: "value",
        min: -1000000,
        max: 1000000,
        step: 1,
        default: 0
    },
    1: {
        name: "Get RC Channel",
        type: "range",
        range: [1, 34],
        default: 1
    },
    2: {
        name: "Flight",
        type: "dictionary",
        default: 0,
        values: {
            0: "ARM timer [s]",
            1: "Home distance [m]",
            2: "Trip distance [m]",
            3: "RSSI",
            4: "Vbat [centi-Volt] [1V = 100]",
            5: "Cell voltage [centi-Volt] [1V = 100]",
            6: "Current [centi-Amp] [1A = 100]",
            7: "Current drawn [mAh]",
            8: "GPS Sats",
            9: "Ground speed [cm/s]",
            10: "3D speed [cm/s]",
            11: "Air speed [cm/s]",
            12: "Altitude [cm]",
            13: "Vertical speed [cm/s]",
            14: "Throttle position [%]",
            15: "Roll [deg]",
            16: "Pitch [deg]",
            17: "Is Armed",
            18: "Is Autolaunch",
            19: "Is Controlling Altitude",
            20: "Is Controlling Position",
            21: "Is Emergency Landing",
            22: "Is RTH",
            23: "Is Landing",
            24: "Is Failsafe",
            25: "Stabilized Roll",
            26: "Stabilized Pitch",
            27: "Stabilized Yaw",
            28: "3D home distance [m]",
            29: "Uplink LQ",
            30: "SNR",
            31: "GPS Valid Fix",
            32: "Loiter Radius [cm]",
            33: "Active Control Profile",
            34: "Battery cells",
            35: "AGL status [0/1]",
            36: "AGL [cm]",
            37: "Rangefinder [cm]",
            38: "Active Mixer Profile",
            39: "Mixer Transition Active",
            40: "Yaw [deg]",
            41: "FW Land State",
            42: "Active Battery Profile",
            43: "Flown Loiter Radius [m]",
            44: "Downlink LQ",
            45: "Uplink RSSI dBm",
        }
    },
    3: {
        name: "Flight Mode",
        type: "dictionary",
        default: 0,
        values: {
            0: "Failsafe",
            1: "Manual",
            2: "RTH",
            3: "Position Hold",
            4: "Cruise",
            5: "Altitude Hold",
            6: "Angle",
            7: "Horizon",
            8: "Air",
            9: "USER 1",
            10: "USER 2",
            11: "Course Hold",
            12: "USER 3",
            13: "USER 4",
            14: "Acro",
            15: "Waypoint Mission",
        }
    },
    4: {
        name: "Logic Condition",
        type: "range",
        range: [0, 63],
        default: 0
    },
    5: {
        name: "Get Global Variable",
        type: "range",
        range: [0, 7],
        default: 0
    },
    6: {
        name: "Programming PID",
        type: "range",
        range: [0, 3],
        default: 0
    },
    7: {
        name: "Waypoints",
        type: "dictionary",
        default: 0,
        values: {
            0: "Is WP",
            1: "Current Waypoint Index",
            2: "Current Waypoint Action",
            3: "Next Waypoint Action",
            4: "Distance to next Waypoint [m]",
            5: "Distance from last Waypoint [m]",
            6: "Current WP has User Action 1",
            7: "Current WP has User Action 2",
            8: "Current WP has User Action 3",
            9: "Current WP has User Action 4",
            10: "Next WP has User Action 1",
            11: "Next WP has User Action 2",
            12: "Next WP has User Action 3",
            13: "Next WP has User Action 4",
        }
    },
};

module.exports = { OPERAND_TYPES };
