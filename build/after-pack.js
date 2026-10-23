// Stamps the Punch icon and name onto Punch.exe (electron-builder's own step needs symlink privileges on Windows).
const path = require('path');
module.exports = async function (context) {
  const mod = await import('rcedit'); const rcedit = mod.rcedit || mod.default?.rcedit || mod.default;
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  await rcedit(exe, {
    icon: path.join(__dirname, 'icon.ico'),
    'version-string': { ProductName: 'Punch', FileDescription: 'Punch', CompanyName: 'Aditi Garg', LegalCopyright: 'Copyright (c) Aditi Garg' },
    'product-version': context.packager.appInfo.version,
    'file-version': context.packager.appInfo.version
  });
};
