function closePopup() {
    document.getElementById("popup").style.display = "none";
}


function openImage(src){

    document.getElementById("modalImage").src = src;

    document.getElementById("imageModal")
        .style.display = "flex";
}

function closeImage(){

    document.getElementById("imageModal")
        .style.display = "none";
}

let image;
let dateInput;

window.onload = function() {

    image =
        document.getElementById("forecastImage");

    dateInput =
        document.getElementById("forecastDate");

    const today = new Date();

    const yyyy = today.getFullYear();

    const mm =
        String(today.getMonth()+1).padStart(2,"0");

    const dd =
        String(today.getDate()).padStart(2,"0");

    dateInput.value =
        `${yyyy}-${mm}-${dd}`;

    dateInput.addEventListener("change", () => {

        frame = 1;

        updateFrame();

    });

    updateFrame();

    playAnimation();
};


let frame = 1;
let timer = null;


function getImagePath() {

    const selectedDate = dateInput.value;

    const dateString =
        selectedDate.replaceAll("-", "");

    const atoll =
        document.getElementById("atollSelect").value;

    const frameString =
        String(frame).padStart(3, "0");

    const path =
        `images/${dateString}/${atoll}_${dateString}_f${frameString}_combined.png`;

    console.log(path);

    return path;
}

function updateFrame() {

    image.src = getImagePath();

    document.getElementById("frameLabel").innerText =
        `Forecast Hour: ${frame}`;

    frame++;

    if(frame > 23)
        frame = 1;
}

function playAnimation() {

    if(timer) return;

    timer = setInterval(updateFrame, 500);
}

function pauseAnimation() {

    clearInterval(timer);

    timer = null;
}
