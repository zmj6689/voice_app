const config = require('../config/env');

function findSpawnPosition(players, networkKey) {
  const sameNetwork = [];
  const everyone = [];
  players.forEach((info) => {
    if (typeof info.x !== 'number' || typeof info.y !== 'number') {
      return;
    }
    everyone.push(info);
    if (info.networkKey === networkKey) {
      sameNetwork.push(info);
    }
  });

  const referenceList = sameNetwork.length > 0 ? sameNetwork : everyone;
  if (referenceList.length === 0) {
    return { x: 0, y: 0 };
  }
  const reference = referenceList[Math.floor(Math.random() * referenceList.length)];
  const angle = Math.random() * Math.PI * 2;
  const distance =
    config.spawnDistanceBase + Math.random() * config.spawnDistanceVariance;
  const offsetX = Math.cos(angle) * distance;
  const offsetY = Math.sin(angle) * distance;
  return {
    x: reference.x + offsetX,
    y: reference.y + offsetY,
  };
}

module.exports = { findSpawnPosition };
