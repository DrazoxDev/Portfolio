const bannerVisitKey = "portfolio-banner-shown";
const banner = document.getElementById("updateBanner");

if (banner && sessionStorage.getItem(bannerVisitKey)) {
  banner.hidden = true;
} else if (banner) {
  sessionStorage.setItem(bannerVisitKey, "true");
  banner.hidden = false;

  const message = "✨ Ce portfolio est en constante évolution au fil de mes études. Revenez bientôt pour découvrir les nouveautés !";
  const textElement = banner.querySelector(".typewriter-text");
  const closeBtn = document.getElementById("closeBannerBtn");
  let index = 0;
  let typewriterTimer;

  function typeWriter() {
    if (index < message.length) {
      textElement.textContent += message.charAt(index);
      index++;
      typewriterTimer = setTimeout(typeWriter, 40);
    }
  }

  typeWriter();

  closeBtn?.addEventListener("click", () => {
    clearTimeout(typewriterTimer);
    banner.style.animation = "fadeOut 0.5s forwards";
    setTimeout(() => {
      banner.hidden = true;
    }, 500);
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || link.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.hasAttribute("download")) return;

  const destination = new URL(link.href, window.location.href);
  if ((destination.protocol === "http:" || destination.protocol === "https:")
      && destination.origin !== window.location.origin) {
    sessionStorage.removeItem(bannerVisitKey);
  }
}, true);
