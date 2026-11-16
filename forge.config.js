const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');

module.exports = {
  packagerConfig: {
    icon: './icon',
    out: 'installers'
  },
  makers: [
    new MakerDeb({}),
    new MakerSquirrel({})
  ]
};
