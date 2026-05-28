const snapCanvas = document.getElementById("snap-canvas");
const snapCtx    = snapCanvas.getContext("2d");

let lastPhotoData = null; // ImageData de la dernière photo prise

// ── PRISE DE PHOTO ────────────────────────────────────────────
window._takePhotoFromVideo = function (video, roomId, socket, username) {
  snapCanvas.width  = video.videoWidth  || 640;
  snapCanvas.height = video.videoHeight || 480;

  snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
  lastPhotoData = snapCtx.getImageData(0, 0, snapCanvas.width, snapCanvas.height);

  displayPhoto(snapCanvas.toDataURL("image/jpeg", 0.85), "Vous");

  // notifier les pairs (on envoie juste un signal, pas les pixels)
  const photoId = Date.now().toString();
  socket.emit("photo-taken", { roomId, photoId });

  // basculer sur l'onglet photos
  const btn = document.querySelector("#sidebar-tabs button:nth-child(3)");
  switchTab("photos", btn);
};

// ── AFFICHAGE ─────────────────────────────────────────────────
function displayPhoto(dataUrl, label) {
  const panel = document.getElementById("photos-panel");

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:4px";

  const lbl = document.createElement("div");
  lbl.style.cssText = "font-size:0.75rem;color:#888";
  lbl.textContent   = label + " — " + new Date().toLocaleTimeString();

  const canvas = document.createElement("canvas");
  canvas.dataset.original = dataUrl;

  const img = new Image();
  img.onload = () => {
    canvas.width  = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
  };
  img.src = dataUrl;

  wrapper.appendChild(lbl);
  wrapper.appendChild(canvas);
  panel.prepend(wrapper);
}

// ── FILTRES (traitement pixel par pixel) ─────────────────────
window.applyFilter = function () {
  if (!lastPhotoData) return alert("Prenez d'abord une photo.");

  const filter  = document.getElementById("filter-select").value;
  const src     = new ImageData(
    new Uint8ClampedArray(lastPhotoData.data),
    lastPhotoData.width,
    lastPhotoData.height
  );

  const result = processPixels(src, filter);

  // afficher le résultat
  const tmp = document.createElement("canvas");
  tmp.width  = result.width;
  tmp.height = result.height;
  tmp.getContext("2d").putImageData(result, 0, 0);
  displayPhoto(tmp.toDataURL(), `Filtre : ${filter}`);
  lastPhotoData = result;
};

function processPixels(imageData, filter) {
  const data = new Uint8ClampedArray(imageData.data);
  const len  = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // alpha data[i+3] inchangé

    switch (filter) {

      case "grayscale": {
        // luminance perceptuelle
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = data[i + 1] = data[i + 2] = gray;
        break;
      }

      case "invert": {
        data[i]     = 255 - r;
        data[i + 1] = 255 - g;
        data[i + 2] = 255 - b;
        break;
      }

      case "sepia": {
        data[i]     = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        break;
      }

      case "redboost": {
        data[i]     = Math.min(255, r * 1.5);
        data[i + 1] = Math.floor(g * 0.7);
        data[i + 2] = Math.floor(b * 0.7);
        break;
      }

      case "threshold": {
        const gray2 = 0.299 * r + 0.587 * g + 0.114 * b;
        const val   = gray2 > 128 ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = val;
        break;
      }
    }
  }

  return new ImageData(data, imageData.width, imageData.height);
}