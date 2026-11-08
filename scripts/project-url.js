window.portfolioProjectSlug = (project) => {
    if (project.slug) return project.slug;
    return project.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "projet";
};

window.portfolioProjectUrl = (project) => `/projets/${window.portfolioProjectSlug(project)}/`;
