/* Loads the app shell and individual UI views before binding application logic. */
const viewFiles = [
  ['./views/login.html'],
  ['./views/app-shell.html'],
];
const tabFiles = [
  './views/tab-collection.html',
  './views/tab-details.html',
  './views/tab-advances.html',
  './views/tab-members.html',
  './views/tab-admin.html',
];

async function loadText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
}

async function bootstrap() {
  const root = document.getElementById('ui-root');
  try {
    const [loginHtml, shellHtml, ...tabs] = await Promise.all([
      loadText(viewFiles[0][0]),
      loadText(viewFiles[1][0]),
      ...tabFiles.map(loadText),
    ]);
    root.innerHTML = loginHtml + shellHtml;
    document.getElementById('tab-views').innerHTML = tabs.join('\n');
    await import('./app.js');
  } catch (error) {
    root.innerHTML = `<main class="load-error"><h1>AK Pack Fitness</h1><p>The app UI could not be loaded.</p><p>${String(error.message || error)}</p><p>Make sure the complete project folder is uploaded and served over HTTP/HTTPS.</p></main>`;
    console.error('App bootstrap failed:', error);
  }
}
bootstrap();
