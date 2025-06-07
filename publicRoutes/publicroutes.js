import { Router } from "express";
import prisma from "../prisma.config.js";
import { setCache, getCache } from "../utils/redis.js";

export const publicRouter = Router();

// GET /api/public/freelancers - Get all freelancer profiles with project details
publicRouter.get('/freelancers', async (req, res) => {
    try {
        const { 
            skills, 
            minRating, 
            location, 
            availability, 
            page = 1, 
            limit = 12 
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const cacheKey = `public:freelancers:${JSON.stringify(req.query)}`;

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        const whereClause = {};

        // Filter by availability
        if (availability !== undefined) {
            whereClause.availability = availability === 'true';
        }

        // Filter by minimum rating
        if (minRating) {
            whereClause.ratings = { gte: parseFloat(minRating) };
        }

        // Filter by skills
        if (skills) {
            const skillsArray = skills.split(',').map(skill => skill.trim());
            whereClause.skills = {
                hasSome: skillsArray
            };
        }

        // User location filter
        if (location) {
            whereClause.user = {
                location: {
                    contains: location,
                    mode: 'insensitive'
                }
            };
        }

        const freelancers = await prisma.freelancer.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        name: true,
                        profileImage: true,
                        bio: true,
                        location: true,
                        createdAt: true
                    }
                },
                assignedProjects: {
                    where: {
                        status: 'COMPLETED'
                    },
                    select: {
                        id: true,
                        title: true,
                        createdAt: true,
                        client: {
                            select: {
                                companyName: true,
                                user: {
                                    select: {
                                        name: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            },
            orderBy: [
                { ratings: 'desc' },
                { projectsCompleted: 'desc' }
            ],
            skip,
            take: parseInt(limit)
        });

        const totalFreelancers = await prisma.freelancer.count({
            where: whereClause
        });

        const responseData = {
            freelancers: freelancers.map(freelancer => ({
                id: freelancer.id,
                profile: {
                    name: freelancer.user.name,
                    profileImage: freelancer.user.profileImage,
                    bio: freelancer.user.bio,
                    location: freelancer.user.location,
                    memberSince: freelancer.user.createdAt
                },
                skills: freelancer.skills,
                experience: freelancer.experience,
                projectsCompleted: freelancer.projectsCompleted,
                ratings: freelancer.ratings,
                hourlyRate: freelancer.hourlyRate,
                availability: freelancer.availability,
                portfolioLinks: {
                    github: freelancer.githubUrl,
                    linkedin: freelancer.linkedinUrl,
                    portfolio: freelancer.portfolioUrl
                },
                completedProjects: freelancer.assignedProjects.map(project => ({
                    title: project.title,
                    completedAt: project.createdAt,
                    client: {
                        name: project.client.user.name,
                        company: project.client.companyName
                    }
                }))
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalFreelancers,
                pages: Math.ceil(totalFreelancers / parseInt(limit))
            }
        };

        // Cache for 10 minutes
        await setCache(cacheKey, responseData, 600);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get public freelancers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/jobs - Get all available jobs/projects
publicRouter.get('/jobs', async (req, res) => {
    try {
        const { 
            skills, 
            budgetMin, 
            budgetMax, 
            duration,
            page = 1, 
            limit = 12 
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const cacheKey = `public:jobs:${JSON.stringify(req.query)}`;

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        const whereClause = {
            status: 'OPEN' // Only show open projects
        };

        // Filter by skills
        if (skills) {
            const skillsArray = skills.split(',').map(skill => skill.trim());
            whereClause.skillsRequired = {
                hasSome: skillsArray
            };
        }

        // Filter by budget range
        if (budgetMin) {
            whereClause.budgetMin = { gte: parseFloat(budgetMin) };
        }
        if (budgetMax) {
            whereClause.budgetMax = { lte: parseFloat(budgetMax) };
        }

        // Filter by duration
        if (duration) {
            whereClause.duration = {
                contains: duration,
                mode: 'insensitive'
            };
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                client: {
                    select: {
                        companyName: true,
                        industry: true,
                        ratings: true,
                        user: {
                            select: {
                                name: true,
                                profileImage: true,
                                location: true
                            }
                        }
                    }
                },
                applications: {
                    select: {
                        id: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        const totalProjects = await prisma.project.count({
            where: whereClause
        });

        const responseData = {
            jobs: projects.map(project => ({
                id: project.id,
                title: project.title,
                description: project.description,
                skillsRequired: project.skillsRequired,
                budget: {
                    min: project.budgetMin,
                    max: project.budgetMax
                },
                duration: project.duration,
                postedAt: project.createdAt,
                applicationsCount: project.applications.length,
                client: {
                    name: project.client.user.name,
                    company: project.client.companyName,
                    industry: project.client.industry,
                    location: project.client.user.location,
                    profileImage: project.client.user.profileImage,
                    ratings: project.client.ratings
                }
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalProjects,
                pages: Math.ceil(totalProjects / parseInt(limit))
            }
        };

        // Cache for 5 minutes
        await setCache(cacheKey, responseData, 300);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get public jobs error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/featured/projects - Get top 3 featured projects
publicRouter.get('/featured/projects', async (req, res) => {
    try {
        const cacheKey = 'public:featured:projects';

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        // Get projects with most applications (indicating popularity)
        const featuredProjects = await prisma.project.findMany({
            where: {
                status: 'OPEN'
            },
            include: {
                client: {
                    select: {
                        companyName: true,
                        industry: true,
                        ratings: true,
                        user: {
                            select: {
                                name: true,
                                profileImage: true,
                                location: true
                            }
                        }
                    }
                },
                applications: {
                    select: {
                        id: true,
                        freelancer: {
                            select: {
                                ratings: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 10 // Get more to filter and randomize
        });

        // Sort by applications count and randomize if tied
        const sortedProjects = featuredProjects
            .map(project => ({
                ...project,
                applicationsCount: project.applications.length,
                averageFreelancerRating: project.applications.length > 0 
                    ? project.applications.reduce((sum, app) => sum + app.freelancer.ratings, 0) / project.applications.length 
                    : 0
            }))
            .sort((a, b) => {
                if (b.applicationsCount === a.applicationsCount) {
                    return Math.random() - 0.5; // Random sort if tied
                }
                return b.applicationsCount - a.applicationsCount;
            })
            .slice(0, 3);

        const responseData = sortedProjects.map(project => ({
            id: project.id,
            title: project.title,
            description: project.description,
            skillsRequired: project.skillsRequired,
            budget: {
                min: project.budgetMin,
                max: project.budgetMax
            },
            duration: project.duration,
            postedAt: project.createdAt,
            applicationsCount: project.applicationsCount,
            averageFreelancerRating: project.averageFreelancerRating,
            client: {
                name: project.client.user.name,
                company: project.client.companyName,
                industry: project.client.industry,
                location: project.client.user.location,
                profileImage: project.client.user.profileImage,
                ratings: project.client.ratings
            }
        }));

        // Cache for 15 minutes
        await setCache(cacheKey, responseData, 900);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get featured projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/featured/freelancers - Get top 3 featured freelancers
publicRouter.get('/featured/freelancers', async (req, res) => {
    try {
        const cacheKey = 'public:featured:freelancers';

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        // Get freelancers ordered by projects completed and ratings
        const featuredFreelancers = await prisma.freelancer.findMany({
            where: {
                availability: true
            },
            include: {
                user: {
                    select: {
                        name: true,
                        profileImage: true,
                        bio: true,
                        location: true,
                        createdAt: true
                    }
                },
                assignedProjects: {
                    where: {
                        status: 'COMPLETED'
                    },
                    select: {
                        id: true,
                        title: true,
                        createdAt: true,
                        client: {
                            select: {
                                companyName: true,
                                user: {
                                    select: {
                                        name: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 5 // Show last 5 projects
                }
            },
            orderBy: [
                { projectsCompleted: 'desc' },
                { ratings: 'desc' }
            ],
            take: 10 // Get more to filter and randomize
        });

        // Randomize if tied in projects completed
        const sortedFreelancers = featuredFreelancers
            .sort((a, b) => {
                if (b.projectsCompleted === a.projectsCompleted) {
                    if (b.ratings === a.ratings) {
                        return Math.random() - 0.5; // Random sort if completely tied
                    }
                    return b.ratings - a.ratings;
                }
                return b.projectsCompleted - a.projectsCompleted;
            })
            .slice(0, 3);

        const responseData = sortedFreelancers.map(freelancer => ({
            id: freelancer.id,
            profile: {
                name: freelancer.user.name,
                profileImage: freelancer.user.profileImage,
                bio: freelancer.user.bio,
                location: freelancer.user.location,
                memberSince: freelancer.user.createdAt
            },
            skills: freelancer.skills,
            experience: freelancer.experience,
            projectsCompleted: freelancer.projectsCompleted,
            ratings: freelancer.ratings,
            hourlyRate: freelancer.hourlyRate,
            portfolioLinks: {
                github: freelancer.githubUrl,
                linkedin: freelancer.linkedinUrl,
                portfolio: freelancer.portfolioUrl
            },
            recentProjects: freelancer.assignedProjects.map(project => ({
                title: project.title,
                completedAt: project.createdAt,
                client: {
                    name: project.client.user.name,
                    company: project.client.companyName
                }
            }))
        }));

        // Cache for 15 minutes
        await setCache(cacheKey, responseData, 900);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get featured freelancers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/stats - Get platform statistics
publicRouter.get('/stats', async (req, res) => {
    try {
        const cacheKey = 'public:platform:stats';

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        const [
            totalFreelancers,
            totalClients,
            totalProjects,
            completedProjects,
            openProjects
        ] = await Promise.all([
            prisma.freelancer.count(),
            prisma.client.count(),
            prisma.project.count(),
            prisma.project.count({ where: { status: 'COMPLETED' } }),
            prisma.project.count({ where: { status: 'OPEN' } })
        ]);

        const responseData = {
            totalFreelancers,
            totalClients,
            totalProjects,
            completedProjects,
            openProjects,
            successRate: totalProjects > 0 ? ((completedProjects / totalProjects) * 100).toFixed(1) : 0
        };

        // Cache for 30 minutes
        await setCache(cacheKey, responseData, 1800);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get platform stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});