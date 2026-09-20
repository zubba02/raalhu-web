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

    document.getElementById("atollSelect")
        .addEventListener("change", () => {

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
        `images/${atoll}/${dateString}/${atoll}_${dateString}_f${frameString}_combined.png`;

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

function nextFrame() {

    pauseAnimation();

    frame++;

    if(frame > 23)
        frame = 1;

    image.src = getImagePath();

    document.getElementById("frameLabel").innerText =
        `Forecast Hour: ${frame}`;
}

function previousFrame() {

    pauseAnimation();

    frame--;

    if(frame < 1)
        frame = 23;

    image.src = getImagePath();

    document.getElementById("frameLabel").innerText =
        `Forecast Hour: ${frame}`;
}

function toggleMenu() {

    const menu = document.getElementById("menuPanel");

    menu.style.display =
        menu.style.display === "block"
        ? "none"
        : "block";
}

document.addEventListener("click", function(event) {

    const menu =
        document.getElementById("menuPanel");

    const button =
        document.getElementById("menuButton");

    if (
        !menu.contains(event.target) &&
        !button.contains(event.target)
    ) {
        menu.style.display = "none";
    }
});
