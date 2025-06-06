import { Router } from "express";
import multer from "multer";
import {
    signup,
    login,
    updateProfile,
    getProfile,
    updateAvailability
} from "./auth.js";

import { authenticateToken } from "../middleware/auth.js";

import prisma from "../prisma.config.js";

export const flRouter = Router();

// Configure multer for file uploads (profile images)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Authentication Routes (Public)
flRouter.post('/signup', upload.single('profileImage'), signup);
flRouter.post('/login', login);

// Profile Management Routes (Protected)
flRouter.get('/profile', authenticateToken, getProfile);
flRouter.put('/profile', authenticateToken, upload.single('profileImage'), updateProfile);
flRouter.put('/availability', authenticateToken, updateAvailability);

// Additional freelancer-specific routes
// GET /api/freelancer/dashboard - Get dashboard data
flRouter.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const freelancer = await prisma.freelancer.findUnique({
            where: { userId },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                        profileImage: true
                    }
                },
                assignedProjects: {
                    include: {
                        client: {
                            include: {
                                user: {
                                    select: {
                                        name: true,
                                        profileImage: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                },
                applications: {
                    include: {
                        project: {
                            include: {
                                client: {
                                    include: {
                                        user: {
                                            select: {
                                                name: true,
                                                profileImage: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 5 // Latest 5 applications
                }
            }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        const stats = {
            totalProjects: freelancer.projectsCompleted,
            activeProjects: freelancer.assignedProjects.filter(p => p.status === 'ASSIGNED').length,
            completedProjects: freelancer.assignedProjects.filter(p => p.status === 'COMPLETED').length,
            rating: freelancer.ratings,
            availability: freelancer.availability,
            pendingApplications: freelancer.applications.filter(app => app.status === 'PENDING').length,
            approvedApplications: freelancer.applications.filter(app => app.status === 'APPROVED').length
        };

        res.status(200).json({
            success: true,
            data: {
                freelancer,
                stats
            }
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/freelancer/projects - Get freelancer's projects
flRouter.get('/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const whereClause = {
            freelancer: {
                userId
            }
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                client: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true
                            }
                        }
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

        res.status(200).json({
            success: true,
            data: {
                projects,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalProjects,
                    pages: Math.ceil(totalProjects / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/freelancer/projects/available - Get available projects for freelancer
flRouter.get('/projects/available', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { skills, budgetMin, budgetMax, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Get freelancer's skills for filtering
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId },
            select: { skills: true, id: true }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        const whereClause = {
            status: 'OPEN',
            assignedTo: null
        };

        // Filter by skills if provided, otherwise use freelancer's skills
        const skillsToFilter = skills ? skills.split(',') : freelancer.skills;
        if (skillsToFilter.length > 0) {
            whereClause.skillsRequired = {
                hasSome: skillsToFilter
            };
        }

        // Filter by budget
        if (budgetMin) {
            whereClause.budgetMin = { gte: parseFloat(budgetMin) };
        }
        if (budgetMax) {
            whereClause.budgetMax = { lte: parseFloat(budgetMax) };
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                client: {
                    include: {
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
                    where: {
                        freelancerId: freelancer.id
                    },
                    select: {
                        id: true,
                        status: true,
                        createdAt: true
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

        res.status(200).json({
            success: true,
            data: {
                projects,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalProjects,
                    pages: Math.ceil(totalProjects / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get available projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// POST /api/freelancer/projects/:projectId/apply - Apply for a project
flRouter.post('/projects/:projectId/apply', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.params;
        const { proposal, coverLetter } = req.body;

        // Check if freelancer exists and is available
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        if (!freelancer.availability) {
            return res.status(400).json({
                success: false,
                message: 'You must be available to apply for projects'
            });
        }

        // Check if project exists and is open
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                client: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        if (project.status !== 'OPEN') {
            return res.status(400).json({
                success: false,
                message: 'Project is not available for applications'
            });
        }

        if (project.assignedTo) {
            return res.status(400).json({
                success: false,
                message: 'Project is already assigned'
            });
        }

        // Check if freelancer has already applied
        const existingApplication = await prisma.application.findUnique({
            where: {
                projectId_freelancerId: {
                    projectId,
                    freelancerId: freelancer.id
                }
            }
        });

        if (existingApplication) {
            return res.status(400).json({
                success: false,
                message: 'You have already applied for this project'
            });
        }

        // Create application
        const application = await prisma.application.create({
            data: {
                projectId,
                freelancerId: freelancer.id,
                proposal,
                coverLetter
            },
            include: {
                project: {
                    include: {
                        client: {
                            include: {
                                user: {
                                    select: {
                                        name: true,
                                        profileImage: true
                                    }
                                }
                            }
                        }
                    }
                },
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        res.status(201).json({
            success: true,
            message: 'Application submitted successfully',
            data: application
        });

    } catch (error) {
        console.error('Apply for project error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/freelancer/applications - Get all applications
flRouter.get('/applications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const freelancer = await prisma.freelancer.findUnique({
            where: { userId },
            select: { id: true }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        const whereClause = {
            freelancerId: freelancer.id
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const applications = await prisma.application.findMany({
            where: whereClause,
            include: {
                project: {
                    include: {
                        client: {
                            include: {
                                user: {
                                    select: {
                                        name: true,
                                        email: true,
                                        profileImage: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        const totalApplications = await prisma.application.count({
            where: whereClause
        });

        res.status(200).json({
            success: true,
            data: {
                applications,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalApplications,
                    pages: Math.ceil(totalApplications / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Error handling middleware for multer
flRouter.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 5MB.'
            });
        }
    }

    if (error.message === 'Only image files are allowed') {
        return res.status(400).json({
            success: false,
            message: 'Only image files are allowed for profile pictures.'
        });
    }

    next(error);
});




