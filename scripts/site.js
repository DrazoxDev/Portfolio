const menuToggle = document.getElementById("menuToggle");
const navMenu = document.querySelector(".nav-menu");

if (menuToggle && navMenu) {
    menuToggle.addEventListener("click", () => {
        navMenu.classList.toggle("active");
        menuToggle.classList.toggle("active");
    });
}

document.addEventListener("click", (event) => {
    const card = event.target.closest(".influence-card");
    if (!card) return;
    flipInfluenceCard(card);
});

document.addEventListener("keydown", (event) => {
    const card = event.target.closest(".influence-card");
    if (!card || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    flipInfluenceCard(card);
});

function flipInfluenceCard(card) {
    card.classList.toggle("flipped");
    card.setAttribute("aria-pressed", String(card.classList.contains("flipped")));
}

const themeToggle = document.getElementById("themeToggle");
if (themeToggle) {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark-mode") {
        document.body.classList.replace("light-mode", "dark-mode");
        themeToggle.checked = true;
    }
    window.dispatchEvent(new Event("portfolio-theme-change"));

    themeToggle.addEventListener("change", () => {
        const theme = themeToggle.checked ? "dark-mode" : "light-mode";
        document.body.classList.replace(
            themeToggle.checked ? "light-mode" : "dark-mode",
            theme
        );
        localStorage.setItem("theme", theme);
        window.dispatchEvent(new Event("portfolio-theme-change"));
    });
}
