"use strict";

const audio2 = document.querySelector("audio#audio2");
const callButton = document.querySelector("button#callButton");
const hangupButton = document.querySelector("button#hangupButton");
const codecSelector = document.querySelector("select#codec");
hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

let pc1;
let pc2;
let localStream;

let bitrateGraph;
let bitrateSeries;
let targetBitrateSeries;
let headerrateSeries;

let packetGraph;
let packetSeries;

let lastResult;

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0,
  voiceActivityDetection: false,
};

const audioLevels = [];
let audioLevelGraph;
let audioLevelSeries;

// Enabling opus DTX is an expert option without GUI.
// eslint-disable-next-line prefer-const
let useDtx = false;

// Disabling Opus FEC is an expert option without GUI.
// eslint-disable-next-line prefer-const
let useFec = false;

const codecPreferences = document.querySelector("#codecPreferences");
const supportsSetCodecPreferences =
  window.RTCRtpTransceiver &&
  "setCodecPreferences" in window.RTCRtpTransceiver.prototype;
console.log(`Supported Codec Preferences = ${supportsSetCodecPreferences}`);
if (supportsSetCodecPreferences) {
  codecSelector.style.display = "none";

  const { codecs } = RTCRtpSender.getCapabilities("audio");
  console.log(`Supported codecs:`);
  console.log(codecs);
  codecs.forEach((codec) => {
    if (["audio/CN", "audio/telephone-event"].includes(codec.mimeType)) {
      return;
    }
    const option = document.createElement("option");
    option.value = (
      codec.mimeType +
      " " +
      codec.clockRate +
      " " +
      (codec.sdpFmtpLine || "")
    ).trim();
    option.innerText = option.value;
    codecPreferences.appendChild(option);
  });
  codecPreferences.disabled = false;
} else {
  codecPreferences.style.display = "none";
}

function hangup() {
  console.log("Ending call");
  localStream.getTracks().forEach((track) => track.stop());
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  codecSelector.disabled = false;
}

function call() {
  callButton.disabled = true;
  codecSelector.disabled = true;
  console.log("Starting call");
  const servers = {
    iceServers: [
      {
        urls: "stun:stun.l.goooooogle.com:19302",
        username: "",
        credentials: "",
      },
    ],
  };
  pc1 = new RTCPeerConnection(servers.iceServers);
  console.log("Created local peer connection object pc1");
  pc1.onicecandidate = (e) => {
    onIceCandidate(pc1, e);
    // const offer = JSON.stringify(pc1.localDescription);
    // console.log("PC1 - Offer");
    // console.log(offer);
  };
  pc2 = new RTCPeerConnection(servers);
  console.log("Created remote peer connection object pc2");
  pc2.onicecandidate = (e) => {
    onIceCandidate(pc2, e);
    // const offer = JSON.stringify(pc1.localDescription);
    // console.log("PC2 - Offer");
    // console.log(offer);
  };
  pc2.ontrack = gotRemoteStream;
  console.log("Requesting local stream");
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: false,
    })
    .then(gotStream)
    .catch((e) => {
      alert(`getUserMedia() error: ${e.name}`);
    });
}

function gotRemoteStream(e) {
  if (audio2.srcObject !== e.streams[0]) {
    audio2.srcObject = e.streams[0];
    console.log("Received remote stream");
  }
}

function gotStream(stream) {
  hangupButton.disabled = false;
  console.log("Received local stream");
  localStream = stream;
  const audioTracks = localStream.getAudioTracks();
  //   audioTracks[0].enabled=false;
  if (audioTracks.length > 0) {
    console.log(`Using Audio device: ${audioTracks[0].label}`);
  }
  localStream.getTracks().forEach((track) => pc1.addTrack(track, localStream));
  console.log("Adding Local Stream to peer connection");

  if (supportsSetCodecPreferences) {
    const preferredCodec =
      codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== "") {
      const [mimeType, clockRate, sdpFmtpLine] =
        preferredCodec.value.split(" ");
      const { codecs } = RTCRtpSender.getCapabilities("audio");

      console.log(mimeType, clockRate, sdpFmtpLine);
      console.log(JSON.stringify(codecs, null, " "));
      const selectedCodecIndex = codecs.findIndex(
        (c) =>
          c.mimeType === mimeType &&
          c.clockRate === parseInt(clockRate, 10) &&
          c.sdpFmtpLine === sdpFmtpLine
      );
      const selectedCodec = codecs[selectedCodecIndex];
      codecs.splice(selectedCodecIndex, 1);
      codecs.unshift(selectedCodec);
      const transceiver = pc1
        .getTransceivers()
        .find(
          (t) => t.sender && t.sender.track === localStream.getAudioTracks()[0]
        );
      transceiver.setCodecPreferences(codecs);
      console.log("Preferred video codec", selectedCodec);
    }
  }

  pc1
    .createOffer(offerOptions)
    .then(gotDescription1, onCreateSessionDescriptionError);

  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView("bitrateGraph", "bitrateCanvas");
  bitrateGraph.updateEndDate();

  targetBitrateSeries = new TimelineDataSeries();
  targetBitrateSeries.setColor("blue");

  headerrateSeries = new TimelineDataSeries();
  headerrateSeries.setColor("green");

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView("packetGraph", "packetCanvas");
  packetGraph.updateEndDate();

  audioLevelSeries = new TimelineDataSeries();
  audioLevelGraph = new TimelineGraphView(
    "audioLevelGraph",
    "audioLevelCanvas"
  );
  audioLevelGraph.updateEndDate();
}

function gotDescription1(desc) {
  console.log(`Offer from pc1\n${desc.sdp}`);
  pc1.setLocalDescription(desc).then(() => {
    if (!supportsSetCodecPreferences) {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
    }
    pc2.setRemoteDescription(desc).then(() => {
      return pc2
        .createAnswer()
        .then(gotDescription2, onCreateSessionDescriptionError);
    }, onSetSessionDescriptionError);
  }, onSetSessionDescriptionError);
}

function gotDescription2(desc) {
  console.log(`Answer from pc2\n${desc.sdp}`);
  pc2.setLocalDescription(desc).then(() => {
    if (!supportsSetCodecPreferences) {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
    }
    if (useDtx) {
      desc.sdp = desc.sdp.replace("useinbandfec=1", "useinbandfec=1;usedtx=1");
    }
    if (!useFec) {
      desc.sdp = desc.sdp.replace("useinbandfec=1", "useinbandfec=0");
    }
    pc1.setRemoteDescription(desc).then(() => {}, onSetSessionDescriptionError);
  }, onSetSessionDescriptionError);
}

function forceChosenAudioCodec(sdp) {
  return maybePreferCodec(sdp, "audio", "send", codecSelector.value);
}

function maybePreferCodec(sdp, type, dir, codec) {
  const str = `${type} ${dir} codec`;
  if (codec === "") {
    console.log(`No preference on ${str}.`);
    return sdp;
  }

  console.log(`Prefer ${str}: ${codec}`);

  const sdpLines = sdp.split("\r\n");

  // Search for m line.
  const mLineIndex = findLine(sdpLines, "m=", type);
  if (mLineIndex === null) {
    return sdp;
  }

  // If the codec is available, set it as the default in m line.
  const codecIndex = findLine(sdpLines, "a=rtpmap", codec);
  console.log("codecIndex", codecIndex);
  if (codecIndex) {
    const payload = getCodecPayloadType(sdpLines[codecIndex]);
    if (payload) {
      sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
    }
  }

  sdp = sdpLines.join("\r\n");
  return sdp;
}

function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  const realEndLine = endLine !== -1 ? endLine : sdpLines.length;
  for (let i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (
        !substr ||
        sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1
      ) {
        return i;
      }
    }
  }
  return null;
}

function getCodecPayloadType(sdpLine) {
  const pattern = new RegExp("a=rtpmap:(\\d+) \\w+\\/\\d+");
  const result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

function setDefaultCodec(mLine, payload) {
  const elements = mLine.split(" ");

  // Just copy the first three parameters; codec order starts on fourth.
  const newLine = elements.slice(0, 3);

  // Put target payload first and copy in the rest.
  newLine.push(payload);
  for (let i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }
  return newLine.join(" ");
}

function onIceCandidate(pc, event) {
    
    getOtherPc(pc)
//   ((pc) => {
//     return pc === pc1 ? pc2 : pc1;
//   })
    .addIceCandidate(event.candidate)
    .then(
      () => onAddIceCandidateSuccess(pc),
      (err) => onAddIceCandidateError(pc, err)
    );
  console.log(
    `${getName(pc)} ICE candidate:\n${
      event.candidate ? event.candidate.candidate : "(null)"
    }`
  );
}

function getName(pc) {
  return pc === pc1 ? "pc1" : "pc2";
}

function onAddIceCandidateError(error) {
  console.log(`Failed to add ICE Candidate: ${error.toString()}`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function onAddIceCandidateSuccess() {
  console.log("AddIceCandidate success.");
}
function getOtherPc(pc) {
  return pc === pc1 ? pc2 : pc1;
}
function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

// query getStats every second
window.setInterval(() => {
  if (!pc1) {
    // console.log(pc1);
    return;
  }
  const sender = pc1.getSenders()[0];
  if (!sender) {
    return;
  }
  sender.getStats().then((res) => {
    res.forEach((report) => {
      //   console.log(report.type);
      let bytes;
      let headerBytes;
      let packets;
      if (report.type === "outbound-rtp") {
        if (report.isRemote) {
          return;
        }
        const now = report.timestamp;
        bytes = report.bytesSent;
        headerBytes = report.headerBytesSent;

        packets = report.packetsSent;
        if (lastResult && lastResult.has(report.id)) {
          const deltaT = (now - lastResult.get(report.id).timestamp) / 1000;
          // calculate bitrate
          const bitrate =
            (8 * (bytes - lastResult.get(report.id).bytesSent)) / deltaT;
          const headerrate =
            (8 * (headerBytes - lastResult.get(report.id).headerBytesSent)) /
            deltaT;
            document.getElementById("bitrate").innerHTML=`Time: - ${now} || bitrate: - ${bitrate}`;
            document.getElementById("headerrate").innerHTML=`Time:- ${now} || headerrate: - ${headerrate}`;
            document.getElementById("targetBitrate").innerHTML=`Time: - ${now} || targetBitrate: - ${report.targetBitrate}`;
            
            

          console.log("bitrate" + now, bitrate);
          console.log("headerrate" + now, headerrate);
          console.log("targetBitrate" + now, report.targetBitrate);
          
          console.log(
            "packets" + now,
            (packets - lastResult.get(report.id).packetsSent) / deltaT
          );
          console.log([packetSeries]);
        }
      }
    });
    lastResult = res;
  });
}, 1000);

if (
  window.RTCRtpReceiver &&
  "getSynchronizationSources" in window.RTCRtpReceiver.prototype
) {
  let lastTime;
  const getAudioLevel = (timestamp) => {
    window.requestAnimationFrame(getAudioLevel);
    if (!pc2) {
      return;
    }
    const receiver = pc2.getReceivers().find((r) => r.track.kind === "audio");
    if (!receiver) {
      return;
    }
    const sources = receiver.getSynchronizationSources();
    sources.forEach((source) => {
      audioLevels.push(source.audioLevel);
    });
    if (!lastTime) {
      lastTime = timestamp;
    } else if (timestamp - lastTime > 500 && audioLevels.length > 0) {
      // Update graph every 500ms.
      const maxAudioLevel = Math.max.apply(null, audioLevels);
      // audioLevelSeries.addPoint(Date.now(), maxAudioLevel);
      // audioLevelGraph.setDataSeries([audioLevelSeries]);
      // audioLevelGraph.updateEndDate();
      audioLevels.length = 0;
      lastTime = timestamp;
    }
  };
  window.requestAnimationFrame(getAudioLevel);
}
