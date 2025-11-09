navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => console.log("Camera access OK"))
    .catch(err => console.error("Camera access failed:", err.name, err.message));

