import {getViewMatrix,getPerspectiveMatrix} from './matrix.js';

const compileBtn = document.getElementById('compileBtn');
const fileSelector = document.getElementById('fileSelector');

window.numParticles = 1000;

const countInput = document.getElementById('count');

countInput.addEventListener('change', (event) => {
  window.numParticles = parseInt(event.target.value, 10);
});

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function replaceVariables(code) {
    return code.replace(/const numParticles = \d+;/, `const numParticles = ${window.numParticles};`);
  }

async function compileAndRun() {
  const selectedFileName = fileSelector.value;
  if (!selectedFileName) {
    alert('Please select a file.');
    return;
  }

  try {
    const filePath = `./rendering/${selectedFileName}`;
    const file = await fetch(filePath).then(response => response.blob());
    const code = await readFile(file);
    eval(replaceVariables(code));
  } catch (error) {
    console.error('Error:', error);
  }
}

compileBtn.addEventListener('click', compileAndRun);

document.addEventListener('DOMContentLoaded', (event) => {
    const collapseElement = document.getElementById('canvasOptions');
    const collapseIndicator = document.querySelector('.collapse-indicator');
  
    // BootstrapのCollapseイベントをバインド
    collapseElement.addEventListener('show.bs.collapse', function () {
      collapseIndicator.textContent = '▼';
    });
    collapseElement.addEventListener('hide.bs.collapse', function () {
      collapseIndicator.textContent = '▶️';
    });
  });
